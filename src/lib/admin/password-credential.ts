// Older hashes: one PBKDF2 pass of 600 000 iterations. Node can still check them, but Cloudflare Workers refuse
// PBKDF2 above 100 000 iterations, so a Worker cannot (see verifyAdminPasswordHash).
const LEGACY_HASH_ALGORITHM = "pbkdf2-sha256";
const LEGACY_HASH_ITERATIONS = 600_000;
// New hashes: six PBKDF2 passes of 100 000 iterations, each pass salted with the output of the one before.
// Same total work as the legacy hash, yet every single call stays inside the Workers limit.
const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256-chain";
const CHAIN_ITERATIONS = 100_000;
const CHAIN_ROUNDS = 6;
const PASSWORD_HASH_PARAMETERS = `${CHAIN_ITERATIONS}x${CHAIN_ROUNDS}`;
const PASSWORD_HASH_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;

export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;

  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const comparedLength = Math.max(left.length, right.length);

  for (let index = 0; index < comparedLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const saltBuffer = new Uint8Array(salt).buffer;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations },
    key,
    PASSWORD_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

async function deriveChainedPasswordHash(password: string, salt: Uint8Array): Promise<Uint8Array> {
  let current = salt;
  for (let round = 0; round < CHAIN_ROUNDS; round += 1) {
    current = await derivePasswordHash(password, current, CHAIN_ITERATIONS);
  }
  return current;
}

export async function constantTimePasswordEqual(provided: string, expected: string): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  return constantTimeBytesEqual(new Uint8Array(providedDigest), new Uint8Array(expectedDigest));
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await deriveChainedPasswordHash(password, salt);
  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_PARAMETERS,
    bytesToBase64Url(salt),
    bytesToBase64Url(hash),
  ].join(":");
}

export async function verifyAdminPasswordHash(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, parameters, saltRaw, hashRaw, extra] = encodedHash.split(":");
  const salt = base64UrlToBytes(saltRaw ?? "");
  const expectedHash = base64UrlToBytes(hashRaw ?? "");

  if (extra !== undefined || salt?.length !== PASSWORD_SALT_BYTES || expectedHash?.length !== PASSWORD_HASH_BYTES) {
    return false;
  }

  if (algorithm === PASSWORD_HASH_ALGORITHM && parameters === PASSWORD_HASH_PARAMETERS) {
    return constantTimeBytesEqual(await deriveChainedPasswordHash(password, salt), expectedHash);
  }
  if (algorithm === LEGACY_HASH_ALGORITHM && Number(parameters) === LEGACY_HASH_ITERATIONS) {
    // In a Worker this throws (iteration limit). The failure is passed on, never mistaken for "wrong password".
    return constantTimeBytesEqual(await derivePasswordHash(password, salt, LEGACY_HASH_ITERATIONS), expectedHash);
  }
  return false;
}

export function validateNewAdminPassword(password: string, confirmation: string): string | null {
  const characterLength = Array.from(password).length;

  if (characterLength < ADMIN_PASSWORD_MIN_LENGTH) {
    return `Новый пароль должен содержать не менее ${ADMIN_PASSWORD_MIN_LENGTH} символов.`;
  }
  if (characterLength > ADMIN_PASSWORD_MAX_LENGTH) {
    return `Новый пароль должен содержать не более ${ADMIN_PASSWORD_MAX_LENGTH} символов.`;
  }
  if (password !== confirmation) {
    return "Новый пароль и подтверждение не совпадают.";
  }
  return null;
}

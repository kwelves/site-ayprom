const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_HASH_ITERATIONS = 600_000;
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

export async function constantTimePasswordEqual(provided: string, expected: string): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  return constantTimeBytesEqual(new Uint8Array(providedDigest), new Uint8Array(expectedDigest));
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);
  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_ITERATIONS,
    bytesToBase64Url(salt),
    bytesToBase64Url(hash),
  ].join(":");
}

export async function verifyAdminPasswordHash(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, iterationsRaw, saltRaw, hashRaw, extra] = encodedHash.split(":");
  const iterations = Number(iterationsRaw);
  const salt = base64UrlToBytes(saltRaw ?? "");
  const expectedHash = base64UrlToBytes(hashRaw ?? "");

  if (
    algorithm !== PASSWORD_HASH_ALGORITHM ||
    extra !== undefined ||
    iterations !== PASSWORD_HASH_ITERATIONS ||
    salt?.length !== PASSWORD_SALT_BYTES ||
    expectedHash?.length !== PASSWORD_HASH_BYTES
  ) {
    return false;
  }

  const actualHash = await derivePasswordHash(password, salt, iterations);
  return constantTimeBytesEqual(actualHash, expectedHash);
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

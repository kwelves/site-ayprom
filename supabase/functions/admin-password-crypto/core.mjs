// Server-to-server password computation for the existing AYPROM credential
// format. No database or session authority lives here. The caller must still
// read the credential version and enforce the login attempt reservation.
import { hashAdminPassword, verifyAdminPasswordHash } from "../../../src/lib/admin/password-credential.ts";

const MAX_BODY_BYTES = 2048;
const MAX_PASSWORD_LENGTH = 128;
const RESPONSE_HEADERS = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };

function answer(status, body) {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function sameSecret(candidate, expected) {
  const encoder = new TextEncoder();
  const [actual, wanted] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actual);
  const right = new Uint8Array(wanted);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function boundedJson(request) {
  if (!request.body) return null;
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_BODY_BYTES) return "oversized";
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) return "oversized";
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
  catch { return null; }
}

export function createAdminPasswordCryptoHandler(readSecret) {
  return async (request) => {
    if (request.method !== "POST") return answer(405, { error: "method_not_allowed" });
    const secret = readSecret();
    if (typeof secret !== "string" || secret.length < 32) return answer(503, { error: "unavailable" });
    const candidate = request.headers.get("x-ayprom-admin-crypto-key");
    if (typeof candidate !== "string" || !await sameSecret(candidate, secret)) return answer(401, { error: "unauthorized" });

    let body;
    try { body = await boundedJson(request); }
    catch { return answer(400, { error: "invalid_request" }); }
    if (body === "oversized") return answer(413, { error: "body_too_large" });
    if (!plainObject(body) || typeof body.password !== "string"
      || body.password.length === 0 || body.password.length > MAX_PASSWORD_LENGTH) {
      return answer(400, { error: "invalid_request" });
    }

    if (body.operation === "verify" && Object.keys(body).length === 3
      && typeof body.encodedHash === "string" && body.encodedHash.length > 0 && body.encodedHash.length <= 1024) {
      try { return answer(200, { valid: await verifyAdminPasswordHash(body.password, body.encodedHash) }); }
      catch { return answer(503, { error: "unavailable" }); }
    }
    if (body.operation === "hash" && Object.keys(body).length === 2
      && Array.from(body.password).length >= 12 && Array.from(body.password).length <= MAX_PASSWORD_LENGTH) {
      try { return answer(200, { hash: await hashAdminPassword(body.password) }); }
      catch { return answer(503, { error: "unavailable" }); }
    }
    return answer(400, { error: "invalid_request" });
  };
}

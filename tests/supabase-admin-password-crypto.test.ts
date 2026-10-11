import { describe, expect, it } from "vitest";
import { createAdminPasswordCryptoHandler } from "../supabase/functions/admin-password-crypto/core.mjs";
import { verifyAdminPasswordHash } from "@/lib/admin/password-credential";
import { GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH } from "./support/legacy-password-verifier-fixtures";

const SECRET = "local-only-crypto-secret-with-enough-entropy-123456";
const URL = "http://localhost/functions/v1/admin-password-crypto";

function request(body: unknown, key: string | null = SECRET): Request {
  return new Request(URL, {
    method: "POST",
    headers: key === null ? {} : { "x-ayprom-admin-crypto-key": key },
    body: JSON.stringify(body),
  });
}

describe("private Supabase password crypto boundary", () => {
  const handler = createAdminPasswordCryptoHandler(() => SECRET);

  it("verifies the existing 600000-iteration hash without changing its format", async () => {
    const correct = await handler(request({ operation: "verify", password: GOLDEN_HASH_PASSWORD, encodedHash: GOLDEN_PBKDF2_HASH }));
    const wrong = await handler(request({ operation: "verify", password: "not-the-password", encodedHash: GOLDEN_PBKDF2_HASH }));
    expect(correct.status).toBe(200);
    expect(await correct.json()).toEqual({ valid: true });
    expect(await wrong.json()).toEqual({ valid: false });
    expect(correct.headers.get("cache-control")).toBe("no-store");
  });

  it("creates a hash readable by the legacy Next and Worker verifier", async () => {
    const result = await handler(request({ operation: "hash", password: GOLDEN_HASH_PASSWORD }));
    expect(result.status).toBe(200);
    const body = await result.json() as { hash: string };
    expect(body.hash).toMatch(/^pbkdf2-sha256-chain:100000x6:/);
    await expect(verifyAdminPasswordHash(GOLDEN_HASH_PASSWORD, body.hash)).resolves.toBe(true);
    await expect(verifyAdminPasswordHash("wrong", body.hash)).resolves.toBe(false);
  });

  it.each([null, "wrong-key"])("rejects missing or wrong private key before parsing the body (%s)", async (key) => {
    const response = await handler(request({ operation: "hash", password: GOLDEN_HASH_PASSWORD }, key));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(GOLDEN_HASH_PASSWORD);
  });

  it("fails closed without a configured secret", async () => {
    const response = await createAdminPasswordCryptoHandler(() => undefined)(request({ operation: "verify", password: GOLDEN_HASH_PASSWORD, encodedHash: GOLDEN_PBKDF2_HASH }));
    expect(response.status).toBe(503);
  });

  it.each([
    { operation: "verify", password: GOLDEN_HASH_PASSWORD },
    { operation: "hash", password: "short" },
    { operation: "hash", password: GOLDEN_HASH_PASSWORD, extra: "unwanted" },
    { operation: "other", password: GOLDEN_HASH_PASSWORD },
  ])("rejects malformed operation %#", async (body) => {
    const response = await handler(request(body));
    expect(response.status).toBe(400);
  });

  it("rejects oversized bodies and non-POST methods", async () => {
    expect((await handler(request({ operation: "hash", password: "x".repeat(3000) }))).status).toBe(413);
    expect((await handler(new Request(URL, { method: "GET", headers: { "x-ayprom-admin-crypto-key": SECRET } }))).status).toBe(405);
  });
});

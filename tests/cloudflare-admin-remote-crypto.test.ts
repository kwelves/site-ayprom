import { describe, expect, it, vi } from "vitest";
import { createRemoteAdminPasswordCrypto } from "@/cloudflare/admin/remote-password-crypto";
import { createLegacyPasswordVerifier } from "@/cloudflare/admin/legacy-password-verifier";
import { GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH } from "./support/legacy-password-verifier-fixtures";

const BINDINGS = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public-test-key",
  ADMIN_CRYPTO_KEY: "local-only-crypto-secret-with-enough-entropy-123456",
};

describe("remote password computation for the unchanged credential scheme", () => {
  it("sends the hash and password only to the fixed private function endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ valid: true }));
    const remote = createRemoteAdminPasswordCrypto(BINDINGS, fetcher as typeof fetch);
    await expect(remote.verifyHash(GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH)).resolves.toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://example.supabase.co/functions/v1/admin-password-crypto");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual(expect.any(Headers));
    const headers = init?.headers as Headers;
    expect(headers.get("x-ayprom-admin-crypto-key")).toBe(BINDINGS.ADMIN_CRYPTO_KEY);
    expect(headers.get("apikey")).toBe(BINDINGS.SUPABASE_PUBLISHABLE_KEY);
    expect(headers.has("authorization")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({ operation: "verify", password: GOLDEN_HASH_PASSWORD, encodedHash: GOLDEN_PBKDF2_HASH });
  });

  it("uses the remote answer with the version from the same row, not local PBKDF2", async () => {
    const remote = vi.fn(async () => true);
    const verifier = createLegacyPasswordVerifier({
      readCredentialState: async () => ({ passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 7 }),
      readEnvPassword: () => { throw new Error("env must not be used"); },
      verifyHash: remote,
    });
    await expect(verifier.verifyPasswordWithVersion(GOLDEN_HASH_PASSWORD)).resolves.toEqual({ valid: true, credentialVersion: 7 });
    expect(remote).toHaveBeenCalledExactlyOnceWith(GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH);
  });

  it("does not call remote crypto while the row is empty and the legacy env password is used", async () => {
    const remote = vi.fn(async () => true);
    const verifier = createLegacyPasswordVerifier({
      readCredentialState: async () => ({ passwordHash: null, sessionVersion: 1 }),
      readEnvPassword: () => "correct-local-env-password",
      verifyHash: remote,
    });
    await expect(verifier.verifyPasswordWithVersion("correct-local-env-password")).resolves.toEqual({ valid: true, credentialVersion: 1 });
    expect(remote).not.toHaveBeenCalled();
  });

  it.each([{}, { valid: 1 }, { valid: true, extra: 1 }])("rejects malformed remote answers %#", async (body) => {
    const remote = createRemoteAdminPasswordCrypto(BINDINGS, async () => Response.json(body));
    await expect(remote.verifyHash(GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH)).rejects.toThrow("Admin password computation unavailable");
  });

  it("fails closed on remote outage and never falls back to an env password", async () => {
    const remote = createRemoteAdminPasswordCrypto(BINDINGS, async () => { throw new Error("secret backend detail"); });
    const verifier = createLegacyPasswordVerifier({
      readCredentialState: async () => ({ passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 }),
      readEnvPassword: () => "correct-local-env-password",
      verifyHash: remote.verifyHash,
    });
    await expect(verifier.verifyPasswordWithVersion("correct-local-env-password")).rejects.toThrow("password_hash_verification_failed");
  });

  it("rejects unusable bindings before any network request", async () => {
    const fetcher = vi.fn(async () => Response.json({ valid: true }));
    expect(() => createRemoteAdminPasswordCrypto({ ...BINDINGS, ADMIN_CRYPTO_KEY: "short" }, fetcher)).toThrow("Admin password computation unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses to send the private key to an unencrypted non-loopback URL", () => {
    expect(() => createRemoteAdminPasswordCrypto({ ...BINDINGS, SUPABASE_URL: "http://example.com" })).toThrow("Admin password computation unavailable");
  });

  it("rejects a forged or truncated hash from the remote generator", async () => {
    const remote = createRemoteAdminPasswordCrypto(BINDINGS, async () => Response.json({ hash: "pbkdf2-sha256:600000:a:b" }));
    await expect(remote.hashPassword(GOLDEN_HASH_PASSWORD)).rejects.toThrow("Admin password computation unavailable");
  });
});

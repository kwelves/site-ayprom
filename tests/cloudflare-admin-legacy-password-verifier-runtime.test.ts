import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";

// Runs the verifier inside the pinned local workerd (Wrangler 4.135.0), not Node.
// Proves Web Crypto API/format compatibility only. Cloudflare enforces CPU limits
// only on its network, so this says nothing about Workers Free 10 ms CPU.
it("verifies env and golden PBKDF2-600000 paths inside real workerd without env fallback", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-legacy-verifier-runtime-"));
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-legacy-verifier-runtime-test",
    main: path.resolve("tests/support/legacy-password-verifier-runtime-entry.ts"),
    compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"],
  }));
  let running;
  try {
    running = await startWrangler(config, directory);
    const probe = async (name: string) => {
      const response = await fetch(`${running!.base}/probe?case=${name}`);
      expect(response.status, name).toBe(200);
      return response.json();
    };

    expect(await probe("env-correct")).toEqual({ ok: true, result: true, envRead: true });
    expect(await probe("env-wrong")).toEqual({ ok: true, result: false, envRead: true });
    expect(await probe("env-unicode")).toEqual({ ok: true, result: true, envRead: true });
    expect(await probe("env-unicode-nfd")).toEqual({ ok: true, result: false, envRead: true });
    expect(await probe("env-short")).toEqual({ ok: false, error: "env_password_unavailable", envRead: true });
    expect(await probe("hash-malformed")).toEqual({ ok: true, result: false, envRead: false });
    expect(await probe("reader-outage")).toEqual({ ok: false, error: "credential_state_unavailable", envRead: false });
    expect(await probe("version")).toEqual({ ok: true, result: 7, envRead: false });

    const capability = await (await fetch(`${running.base}/pbkdf2?iterations=600000`)).json();
    const golden = await probe("hash-golden-correct");
    const envAgainstHash = await probe("hash-golden-env-password");
    // The env password must never unlock a hashed row, whatever the runtime can do.
    expect(envAgainstHash.result).not.toBe(true);
    expect(golden.envRead).toBe(false);
    expect(envAgainstHash.envRead).toBe(false);
    if (capability.supported) {
      // Observed on pinned local workerd 4.135.0.
      expect(golden).toEqual({ ok: true, result: true, envRead: false });
      expect(envAgainstHash).toEqual({ ok: true, result: false, envRead: false });
    } else {
      expect(golden).toEqual({ ok: false, error: "password_hash_verification_failed", envRead: false });
      expect(envAgainstHash).toEqual({ ok: false, error: "password_hash_verification_failed", envRead: false });
    }
    // Pins the local runtime fact reported in docs/superpowers/reports/2026-09-30-claude-legacy-password-verifier.md.
    expect(capability).toEqual({ supported: true });

    const responseText = JSON.stringify([golden, envAgainstHash, await probe("env-correct")]);
    expect(responseText).not.toMatch(/fixture|golden-fixture|pbkdf2-sha256|AAECAwQF|фиктивный/);
  } finally {
    await stopWrangler(running?.child);
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 120_000);

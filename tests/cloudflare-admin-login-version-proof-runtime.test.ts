import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";

// Real pinned local workerd (Wrangler 4.135.0), no Supabase and no network. The
// test entry runs the real handler + legacy verifier against an in-memory
// credential row that is changed at exact points of the login. Local runs do not
// enforce Cloudflare CPU limits; this proves behaviour, not Workers Free CPU.
it("issues a session only with the proven version inside real workerd", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-login-proof-runtime-"));
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-login-version-proof-runtime-test",
    main: path.resolve("tests/support/login-version-proof-runtime-entry.ts"),
    compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"],
  }));

  let running;
  const bodies: string[] = [];
  try {
    running = await startWrangler(config, directory);
    const run = async (name: string, password: string) => {
      const response = await fetch(`${running!.base}/scenario?name=${name}&password=${password}`);
      const text = await response.text();
      bodies.push(text);
      expect(response.status, name).toBe(200);
      return JSON.parse(text);
    };

    // Stable: cookie carries the proven version 2; one read to verify, one to compare.
    expect(await run("stable", "golden")).toEqual({
      status: 303, location: "/admin", cookieIssued: true, cookieVersion: 2,
      finishArgs: [true], legacyPortCalls: 0, reads: 2,
      // The later change 2→3 revokes the session at the next protected request.
      laterAdmin: { status: 302, location: "/admin/login?session=expired" },
    });

    // Empty credential row: only the fictitious env password, session version 1.
    expect(await run("empty-env", "env")).toMatchObject({ location: "/admin", cookieIssued: true, cookieVersion: 1, legacyPortCalls: 0 });

    // The reader returned a shared object, mutated by the env-password port.
    // The verifier must snapshot version 1 before checking the password, then
    // the handler must reject it against the newly observed version 2.
    expect(await run("shared-env-mutation", "env")).toEqual({
      status: 303, location: "/admin/login?error=security", cookieIssued: false, cookieVersion: null,
      finishArgs: [true], legacyPortCalls: 0, reads: 2,
    });

    // The credential changes 2→3 right after the state read, or during finish:
    // the correct old password must not receive a version-3 cookie.
    for (const scenario of ["bump-during-verify", "bump-during-finish"]) {
      expect(await run(scenario, "golden"), scenario).toEqual({
        status: 303, location: "/admin/login?error=security", cookieIssued: false, cookieVersion: null,
        finishArgs: [true], legacyPortCalls: 0, reads: 2,
      });
    }

    // Wrong password (also the env password against a hashed row): no fallback.
    for (const password of ["wrong", "env"]) {
      expect(await run("stable", password), password).toEqual({
        status: 303, location: "/admin/login?error=1", cookieIssued: false, cookieVersion: null,
        finishArgs: [false], legacyPortCalls: 0, reads: 1,
      });
    }

    // Reader outage and malformed proof: fail closed, no cookie, no legacy boolean port.
    expect(await run("reader-outage", "env")).toEqual({
      status: 303, location: "/admin/login?error=security", cookieIssued: false, cookieVersion: null,
      finishArgs: [false], legacyPortCalls: 0, reads: 1,
    });
    expect(await run("malformed-proof", "golden")).toEqual({
      status: 303, location: "/admin/login?error=security", cookieIssued: false, cookieVersion: null,
      finishArgs: [false], legacyPortCalls: 0, reads: 0,
    });

    expect(bodies.join("\n")).not.toMatch(/admin_session|pbkdf2|AAECAwQF|fixture-env-password|golden-fixture|fixture-wrong/);
  } finally {
    await stopWrangler(running?.child);
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 120_000);

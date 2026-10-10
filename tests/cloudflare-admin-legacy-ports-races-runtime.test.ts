import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";
import { FIXTURE_ENV_PASSWORD, GOLDEN_PBKDF2_HASH } from "./support/legacy-password-verifier-fixtures";

// Real pinned local workerd (Wrangler 4.135.0): the REAL admin handler, credential
// reader and legacy verifier (no password check is stubbed) run against a loopback
// HTTP backend that changes the credential row at exact points of the login. No
// Supabase, no Docker, no external network; every value is fictitious. Local runs
// do not enforce Cloudflare CPU limits: this proves behaviour, not Workers Free CPU.
const FIXTURE_KEY = "sb_secret_fake08";

interface Row { hash: boolean; version: number }

it("keeps the session bound to the proven version across changes inside real workerd", async () => {
  let row: Row | null = null; // null = empty credential row
  let failReads = false;
  let onFinish: (() => void) | null = null;
  const requests: { method: string; pathname: string; apikey?: string; authorization?: string; body: string }[] = [];
  const readVersions: (number | "error" | "empty")[] = [];

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const pathname = new URL(req.url ?? "/", "http://local").pathname;
      requests.push({
        method: req.method ?? "", pathname,
        apikey: req.headers.apikey as string | undefined, authorization: req.headers.authorization, body,
      });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (pathname.endsWith("/begin_admin_auth_attempt")) {
        return send(200, [{ out_allowed: true, out_retry_after: 0, out_reservation_id: "races-reservation" }]);
      }
      if (pathname.endsWith("/finish_admin_auth_attempt")) {
        // The credential changes (or its read starts failing) while finish is in flight.
        onFinish?.();
        return send(200, 0);
      }
      if (pathname === "/rest/v1/admin_credentials") {
        if (failReads) {
          readVersions.push("error");
          return send(503, { message: "unavailable" });
        }
        if (!row) {
          readVersions.push("empty");
          return send(200, []);
        }
        readVersions.push(row.version);
        return send(200, [{ password_hash: GOLDEN_PBKDF2_HASH, session_version: row.version }]);
      }
      return send(404, { message: "unexpected" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");

  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-legacy-ports-races-runtime-"));
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-legacy-ports-races-runtime-test",
    main: path.resolve("tests/support/legacy-admin-ports-runtime-entry.ts"),
    compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      SUPABASE_URL: `http://127.0.0.1:${address.port}`,
      ADMIN_SUPABASE_KEY: FIXTURE_KEY,
      ADMIN_PASSWORD: FIXTURE_ENV_PASSWORD,
    },
  }));

  let running;
  let logs = "";
  const bodies: string[] = [];
  try {
    running = await startWrangler(config, directory);
    for (const stream of [running.child.stdout, running.child.stderr]) stream?.on("data", (chunk) => { logs += chunk.toString(); });

    function reset(next: Row | null) {
      row = next;
      failReads = false;
      onFinish = null;
    }
    async function call(route: string) {
      const before = requests.length;
      const beforeReads = readVersions.length;
      const response = await fetch(`${running!.base}${route}`);
      const text = await response.text();
      bodies.push(text);
      expect(response.status, route).toBe(200);
      return {
        result: JSON.parse(text),
        calls: requests.slice(before),
        reads: readVersions.slice(beforeReads),
      };
    }
    const shape = (calls: typeof requests) => calls.map((c) => `${c.method} ${c.pathname}`);
    const finishBodies = (calls: typeof requests) =>
      calls.filter((c) => c.pathname.endsWith("/finish_admin_auth_attempt")).map((c) => JSON.parse(c.body));
    const LOGIN_SHAPE = [
      "POST /rest/v1/rpc/begin_admin_auth_attempt",
      "GET /rest/v1/admin_credentials",
      "POST /rest/v1/rpc/finish_admin_auth_attempt",
      "GET /rest/v1/admin_credentials",
    ];
    const FINISH_TRUE = { p_reservation_id: "races-reservation", p_password_is_valid: true };
    const FINISH_FALSE = { p_reservation_id: "races-reservation", p_password_is_valid: false };
    const REFUSED = { location: "/admin/login?error=security", cookieIssued: false, cookieVersion: null };

    // 1. The credential version moves while the finish RPC runs.
    for (const [label, start, after, password] of [
      ["hash 2→3", { hash: true, version: 2 }, { hash: true, version: 3 }, "golden"],
      ["hash 3→4", { hash: true, version: 3 }, { hash: true, version: 4 }, "golden"],
      ["empty row (env) → hash 2", null, { hash: true, version: 2 }, "env"],
    ] as [string, Row | null, Row, string][]) {
      reset(start);
      onFinish = () => { row = after; };
      const attempt = await call(`/login?password=${password}`);
      expect(attempt.result, label).toEqual(REFUSED);
      expect(shape(attempt.calls), label).toEqual(LOGIN_SHAPE);
      expect(finishBodies(attempt.calls), label).toEqual([FINISH_TRUE]); // finish called exactly once
      expect(attempt.reads, label).toEqual([start ? start.version : "empty", after.version]);
      // No session was stored: a protected request has nothing to present.
      expect((await call("/admin")).result, label).toEqual({ noSession: true });
    }

    // 2. A stable login issues the proven version; a later change rejects that session.
    reset({ hash: true, version: 3 });
    const stable = await call("/login?password=golden");
    expect(stable.result).toEqual({ location: "/admin", cookieIssued: true, cookieVersion: 3 });
    expect(shape(stable.calls)).toEqual(LOGIN_SHAPE);
    expect(finishBodies(stable.calls)).toEqual([FINISH_TRUE]);
    expect(stable.reads).toEqual([3, 3]);

    const stillValid = await call("/admin");
    expect(stillValid.result).toEqual({ status: 200, location: null, cookieCleared: false, assetFetches: 1 });

    row = { hash: true, version: 4 }; // the password is changed after the session was issued
    const revoked = await call("/admin");
    expect(revoked.result).toEqual({
      status: 302, location: "/admin/login?session=expired", cookieCleared: true, assetFetches: 0,
    });
    expect(revoked.reads).toEqual([4]);

    // 3. Reading the credentials fails after finish: no cookie and no env fallback.
    // Hash row (golden) and empty row (env): with an env fallback the empty-row
    // variant would still match its proven version 1 and issue a cookie.
    for (const [label, start, password] of [
      ["hash row", { hash: true, version: 3 } as Row | null, "golden"],
      ["empty row with env password", null, "env"],
    ] as [string, Row | null, string][]) {
      reset(start);
      onFinish = () => { failReads = true; };
      const attempt = await call(`/login?password=${password}`);
      expect(attempt.result, label).toEqual(REFUSED);
      expect(shape(attempt.calls), label).toEqual(LOGIN_SHAPE); // no extra read, no retry
      expect(finishBodies(attempt.calls), label).toEqual([FINISH_TRUE]);
      expect(attempt.reads, label).toEqual([start ? start.version : "empty", "error"]);
      expect((await call("/admin")).result, label).toEqual({ noSession: true });
    }

    // Never a GoTrue call; the private key only in `apikey`, never in a body or as Bearer.
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.pathname.startsWith("/auth")).toBe(false);
      expect(request.apikey).toBe(FIXTURE_KEY);
      expect(request.authorization).toBeUndefined();
      expect(request.body).not.toContain(FIXTURE_KEY);
    }
    // Sanity for a wrong password: finish(false) once, no cookie.
    reset({ hash: true, version: 3 });
    const wrong = await call("/login?password=wrong");
    expect(wrong.result).toEqual({ location: "/admin/login?error=1", cookieIssued: false, cookieVersion: null });
    expect(finishBodies(wrong.calls)).toEqual([FINISH_FALSE]);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(logs).toContain("/login");
    const visible = [...bodies, logs].join("\n");
    expect(visible).not.toContain(FIXTURE_KEY);
    expect(visible).not.toMatch(/sb_secret|pbkdf2-sha256|AAECAwQF|fixture-env-password|golden-fixture|admin_session=/);
  } finally {
    await stopWrangler(running?.child);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 180_000);

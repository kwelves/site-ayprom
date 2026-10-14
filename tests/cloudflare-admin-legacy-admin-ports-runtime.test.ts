import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";
import { FIXTURE_ENV_PASSWORD, GOLDEN_PBKDF2_HASH } from "./support/legacy-password-verifier-fixtures";

// Real pinned local workerd (Wrangler 4.135.0) against a controlled loopback HTTP
// backend: no Supabase, no Docker, no external network. All values are fictitious.
// Local runs do not enforce Cloudflare CPU limits; this proves composition, not
// Workers Free CPU.
const FIXTURE_KEY = "sb_secret_fake05";

type Mode = "empty" | "hash-v3" | "outage" | "missing-table" | "two-rows";

it("composes legacy admin ports inside real workerd without Auth or fallback", async () => {
  let mode: Mode = "empty";
  const requests: { method: string; pathname: string; apikey?: string; authorization?: string; body: string }[] = [];

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
        return send(200, [{ out_allowed: true, out_retry_after: 0, out_reservation_id: "runtime-reservation" }]);
      }
      if (pathname.endsWith("/finish_admin_auth_attempt")) return send(200, 0);
      if (pathname === "/rest/v1/admin_credentials") {
        const row = { password_hash: GOLDEN_PBKDF2_HASH, session_version: 3 };
        switch (mode) {
          case "empty": return send(200, []);
          case "hash-v3": return send(200, [row]);
          case "two-rows": return send(200, [row, row]);
          case "outage": return send(503, { message: "unavailable" });
          case "missing-table": return send(404, { code: "PGRST205", message: "Could not find the table" });
        }
      }
      return send(404, { message: "unexpected" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");

  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-legacy-admin-ports-runtime-"));
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-legacy-admin-ports-runtime-test",
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
    // Capture everything Wrangler/workerd prints from here on (requests included).
    for (const stream of [running.child.stdout, running.child.stderr]) stream?.on("data", (chunk) => { logs += chunk.toString(); });

    const login = async (next: Mode, password: string) => {
      mode = next;
      const before = requests.length;
      const response = await fetch(`${running!.base}/login?password=${password}`);
      const text = await response.text();
      bodies.push(text);
      expect(response.status, `${next} ${password}`).toBe(200);
      return { result: JSON.parse(text), calls: requests.slice(before) };
    };
    const shape = (calls: typeof requests) => calls.map((call) => `${call.method} ${call.pathname}`);
    const finishBody = (calls: typeof requests) => JSON.parse(calls.at(-1)!.body);

    // Empty row: the fictitious env password signs in with version 1.
    const empty = await login("empty", "env");
    expect(empty.result).toEqual({ location: "/admin", cookieIssued: true, cookieVersion: 1 });
    expect(shape(empty.calls)).toEqual([
      "POST /rest/v1/rpc/begin_admin_auth_attempt",
      "GET /rest/v1/admin_credentials",
      "POST /rest/v1/rpc/finish_admin_auth_attempt",
      "GET /rest/v1/admin_credentials",
    ]);

    // Hash row of version 3: the golden password signs in with version 3.
    expect((await login("hash-v3", "golden")).result).toEqual({ location: "/admin", cookieIssued: true, cookieVersion: 3 });

    // The env password is not accepted instead of an existing hash.
    const envAgainstHash = await login("hash-v3", "env");
    expect(envAgainstHash.result).toEqual({ location: "/admin/login?error=1", cookieIssued: false, cookieVersion: null });
    expect(finishBody(envAgainstHash.calls)).toEqual({ p_reservation_id: "runtime-reservation", p_password_is_valid: false });

    // Wrong password on an empty row.
    expect((await login("empty", "wrong")).result).toEqual({ location: "/admin/login?error=1", cookieIssued: false, cookieVersion: null });

    // Missing table, outage and a malformed row never fall back to the env password.
    for (const failing of ["missing-table", "outage", "two-rows"] as const) {
      const attempt = await login(failing, "env");
      expect(attempt.result, failing).toEqual({ location: "/admin/login?error=security", cookieIssued: false, cookieVersion: null });
      expect(finishBody(attempt.calls), failing).toEqual({ p_reservation_id: "runtime-reservation", p_password_is_valid: false });
    }

    // Unusable bindings are refused with the fixed error, before any I/O.
    for (const name of ["no-key", "no-url"]) {
      const before = requests.length;
      const response = await fetch(`${running.base}/construct?case=${name}`);
      const text = await response.text();
      bodies.push(text);
      expect(JSON.parse(text)).toEqual({ threw: true, message: "Admin protection unavailable" });
      expect(requests.length).toBe(before);
    }

    // Every backend request: private key in apikey only, no Bearer for a non-JWT key, never /auth.
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.pathname.startsWith("/auth")).toBe(false);
      expect(request.apikey).toBe(FIXTURE_KEY);
      expect(request.authorization).toBeUndefined();
      expect(request.body).not.toContain(FIXTURE_KEY);
    }

    // Give Wrangler a moment to flush request logs, and prove the capture works.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(logs).toContain("/login");
    const everythingVisible = [...bodies, logs].join("\n");
    expect(everythingVisible).not.toContain(FIXTURE_KEY);
    expect(everythingVisible).not.toMatch(/sb_secret|pbkdf2-sha256|AAECAwQF|fixture-env-password|admin_session=/);
  } finally {
    await stopWrangler(running?.child);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 120_000);

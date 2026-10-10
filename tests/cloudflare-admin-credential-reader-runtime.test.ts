import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";
import { GOLDEN_PBKDF2_HASH } from "./support/legacy-password-verifier-fixtures";

// Real pinned local workerd (Wrangler 4.135.0) against a controlled loopback
// HTTP fixture — no Supabase stack, no external network. Proves request shape,
// the empty-vs-failure policy and the bounded transport inside the runtime.
const FIXTURE_KEY = "sb_secret_fake01";
const EXPECTED_PATH =
  "/rest/v1/admin_credentials?select=password_hash%2Csession_version&credential_key=eq.primary&limit=2";

type Mode =
  | "empty" | "hash" | "hash-v3" | "two" | "missing-table" | "forbidden" | "outage"
  | "redirect" | "oversized" | "malformed" | "stall";

it("reads credential state inside real workerd with the strict empty-vs-failure policy", async () => {
  let mode: Mode = "empty";
  const requests: { method: string; url: string; apikey?: string; authorization?: string }[] = [];
  let sinkHits = 0;
  const stalled: ServerResponse[] = [];

  const server = createServer((req, res) => {
    if (req.url === "/sink") {
      sinkHits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end("[]");
      return;
    }
    requests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      apikey: req.headers.apikey as string | undefined,
      authorization: req.headers.authorization,
    });
    const send = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(body);
    };
    const row = (version: number) => JSON.stringify([{ password_hash: GOLDEN_PBKDF2_HASH, session_version: version }]);
    switch (mode) {
      case "empty": return send(200, "[]");
      case "hash": return send(200, row(2));
      case "hash-v3": return send(200, row(3));
      case "two": return send(200, JSON.stringify([...JSON.parse(row(2)), ...JSON.parse(row(2))]));
      case "missing-table": return send(404, JSON.stringify({ code: "PGRST205", message: "Could not find the table" }));
      case "forbidden": return send(403, JSON.stringify({ code: "42501", message: "permission denied" }));
      case "outage": return send(503, JSON.stringify({ message: "unavailable" }));
      case "redirect": return send(307, "", { location: `http://127.0.0.1:${port}/sink` });
      case "oversized": return send(200, `[${" ".repeat(70_000)}]`);
      case "malformed": return send(200, "[{");
      case "stall":
        res.writeHead(200, { "content-type": "application/json" });
        res.write("[");
        stalled.push(res);
        return;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const port = address.port;

  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-credential-reader-runtime-"));
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-credential-reader-runtime-test",
    main: path.resolve("tests/support/credential-reader-runtime-entry.ts"),
    compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"],
    vars: { SUPABASE_URL: `http://127.0.0.1:${port}`, ADMIN_SUPABASE_KEY: FIXTURE_KEY },
  }));

  let running;
  const bodies: string[] = [];
  try {
    running = await startWrangler(config, directory);
    const call = async (next: Mode, route: string) => {
      mode = next;
      const before = requests.length;
      const response = await fetch(`${running!.base}${route}`);
      const text = await response.text();
      bodies.push(text);
      expect(response.status, `${next} ${route}`).toBe(200);
      // Exactly one backend request per call: no retries, no second query.
      expect(requests.length - before, `${next} ${route}`).toBe(1);
      return JSON.parse(text);
    };

    expect(await call("empty", "/state?expectVersion=1")).toEqual({ ok: true, hasHash: false, versionMatches: true });
    expect(await call("hash", "/state?expectVersion=2")).toEqual({ ok: true, hasHash: true, versionMatches: true });
    expect(await call("hash-v3", "/state?expectVersion=3")).toEqual({ ok: true, hasHash: true, versionMatches: true });
    expect(await call("two", "/state?expectVersion=1")).toEqual({ ok: false, error: "response_invalid" });
    for (const failing of ["missing-table", "forbidden", "outage", "redirect", "oversized", "malformed"] as const) {
      expect(await call(failing, "/state?expectVersion=1"), failing).toEqual({ ok: false, error: "backend_unavailable" });
    }

    // Reader + legacy verifier inside workerd.
    expect(await call("empty", "/verify?password=env")).toEqual({ ok: true, result: true, envRead: true });
    expect(await call("empty", "/verify?password=wrong")).toEqual({ ok: true, result: false, envRead: true });
    expect(await call("hash", "/verify?password=golden")).toEqual({ ok: true, result: true, envRead: false });
    expect(await call("hash", "/verify?password=env")).toEqual({ ok: true, result: false, envRead: false });
    for (const failing of ["missing-table", "outage", "forbidden"] as const) {
      expect(await call(failing, "/verify?password=env"), failing)
        .toEqual({ ok: false, error: "credential_state_unavailable", envRead: false });
    }

    // A backend that sends headers and then stalls is cut by the shared deadline.
    const started = Date.now();
    expect(await call("stall", "/state?expectVersion=1")).toEqual({ ok: false, error: "backend_unavailable" });
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeGreaterThanOrEqual(9_000);
    expect(elapsedMs).toBeLessThan(30_000);

    for (const request of requests) {
      expect(request.method).toBe("GET");
      expect(request.url).toBe(EXPECTED_PATH);
      expect(request.apikey).toBe(FIXTURE_KEY);
      expect(request.authorization).toBeUndefined();
    }
    expect(sinkHits).toBe(0);
    expect(bodies.join("\n")).not.toMatch(/sb_secret|pbkdf2|AAECAwQF|fixture-env-password|golden-fixture|42501|PGRST205/);
  } finally {
    for (const res of stalled) res.destroy();
    await stopWrangler(running?.child);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 180_000);

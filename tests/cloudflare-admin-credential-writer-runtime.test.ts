import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";
import { GOLDEN_PBKDF2_HASH, MALFORMED_HASH } from "./support/legacy-password-verifier-fixtures";

// Real pinned local workerd (Wrangler 4.135.0) against a loopback HTTP backend.
// THE BACKEND IS A FICTITIOUS IN-MEMORY EMULATION of the PostgREST behaviours the
// writer relies on (409/23505 on a duplicate primary key, PATCH filtered by
// session_version returning the updated rows, `return=representation`); it is NOT a
// real PostgREST or Postgres. No Supabase, no Docker, no external network. Local
// runs do not enforce Cloudflare CPU limits.
const FIXTURE_KEY = "sb_secret_fake03";

type Mode = "normal" | "outage" | "redirect" | "oversized" | "hang" | "wrong-version" | "malformed" | "other-409";

it("replaces the credential hash with compare-and-set semantics inside real workerd", async () => {
  let table: { hash: string; version: number } | null = null;
  let mode: Mode = "normal";
  let sinkHits = 0;
  const stalled: import("node:http").ServerResponse[] = [];
  const requests: { method: string; url: string; apikey?: string; authorization?: string; prefer?: string; body: string }[] = [];

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const parsed = new URL(req.url ?? "/", "http://local");
      if (parsed.pathname === "/sink") {
        sinkHits += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end("[]");
        return;
      }
      requests.push({
        method: req.method ?? "", url: req.url ?? "",
        apikey: req.headers.apikey as string | undefined, authorization: req.headers.authorization,
        prefer: req.headers.prefer as string | undefined, body,
      });
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      const isWrite = req.method === "POST" || req.method === "PATCH";
      if (isWrite && mode !== "normal") {
        switch (mode) {
          case "outage": return send(503, { message: "unavailable" });
          // A foreign-key style conflict is not "someone else changed the password".
          case "other-409": return send(409, { code: "23503", message: "foreign key violation" });
          case "redirect": res.writeHead(307, { location: `http://127.0.0.1:${port}/sink` }); return void res.end();
          case "oversized":
            res.writeHead(200, { "content-type": "application/json" });
            return void res.end(`[${" ".repeat(70_000)}]`);
          case "hang":
            res.writeHead(200, { "content-type": "application/json" });
            res.write("[");
            stalled.push(res);
            return;
          case "wrong-version": return send(req.method === "POST" ? 201 : 200, [{ session_version: 99 }]);
          case "malformed":
            res.writeHead(200, { "content-type": "application/json" });
            return void res.end("[{");
        }
      }
      if (parsed.pathname !== "/rest/v1/admin_credentials") return send(404, { message: "unexpected" });

      if (req.method === "GET") {
        return send(200, table ? [{ password_hash: table.hash, session_version: table.version }] : []);
      }
      const values = JSON.parse(body);
      if (req.method === "POST") {
        if (values.credential_key !== "primary" || values.session_version < 2) return send(400, { code: "23514" });
        if (table) return send(409, { code: "23505", message: "duplicate key value" });
        table = { hash: values.password_hash, version: values.session_version };
        return send(201, [{ session_version: table.version }]);
      }
      if (req.method === "PATCH") {
        const wanted = Number(/^eq\.(\d+)$/.exec(parsed.searchParams.get("session_version") ?? "")?.[1]);
        if (parsed.searchParams.get("credential_key") !== "eq.primary" || !table || table.version !== wanted) {
          return send(200, []);
        }
        table = { hash: values.password_hash, version: values.session_version };
        return send(200, [{ session_version: table.version }]);
      }
      return send(405, { message: "method" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const port = address.port;

  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-credential-writer-runtime-"));
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-credential-writer-runtime-test",
    main: path.resolve("tests/support/credential-writer-runtime-entry.ts"),
    compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"],
    vars: { SUPABASE_URL: `http://127.0.0.1:${port}`, ADMIN_SUPABASE_KEY: FIXTURE_KEY },
  }));

  let running;
  let logs = "";
  const bodies: string[] = [];
  try {
    running = await startWrangler(config, directory);
    for (const stream of [running.child.stdout, running.child.stderr]) stream?.on("data", (chunk) => { logs += chunk.toString(); });

    async function call(route: string, next: Mode = "normal") {
      mode = next;
      const before = requests.length;
      const response = await fetch(`${running!.base}${route}`);
      const text = await response.text();
      bodies.push(text);
      expect(response.status, route).toBe(200);
      return { result: JSON.parse(text), calls: requests.slice(before) };
    }
    const replace = (hash: string, expected: string | number, next: Mode = "normal") =>
      call(`/replace?hash=${hash}&expected=${expected}`, next);

    // Empty table: reader sees the empty state, INSERT creates version 2.
    expect((await call("/state")).result).toEqual({ ok: true, hasHash: false, version: 1 });
    const inserted = await replace("golden", 1);
    expect(inserted.result).toEqual({ ok: true, version: 2 });
    expect(inserted.calls.map((c) => c.method)).toEqual(["POST"]);
    expect(table).toEqual({ hash: GOLDEN_PBKDF2_HASH, version: 2 });
    expect((await call("/state")).result).toEqual({ ok: true, hasHash: true, version: 2 });

    // Version >= 2: PATCH bound to the expected version, then again.
    const patched = await replace("other", 2);
    expect(patched.result).toEqual({ ok: true, version: 3 });
    expect(patched.calls.map((c) => c.method)).toEqual(["PATCH"]);
    expect(table).toEqual({ hash: MALFORMED_HASH, version: 3 });

    // Stale version and duplicate insert are conflicts and change nothing.
    expect((await replace("golden", 2)).result).toEqual({ ok: false, code: "conflict" });
    expect((await replace("golden", 1)).result).toEqual({ ok: false, code: "conflict" });
    expect(table).toEqual({ hash: MALFORMED_HASH, version: 3 });

    // Two writers with the same expected version: exactly one wins.
    mode = "normal";
    const race = await Promise.all([
      fetch(`${running.base}/replace?hash=golden&expected=3`).then((r) => r.text()),
      fetch(`${running.base}/replace?hash=other&expected=3`).then((r) => r.text()),
    ]);
    bodies.push(...race);
    const outcomes = race.map((text) => JSON.parse(text)).sort((a, b) => Number(b.ok) - Number(a.ok));
    expect(outcomes).toEqual([{ ok: true, version: 4 }, { ok: false, code: "conflict" }]);
    // `table` is assigned inside the server callback, which TypeScript's flow analysis cannot see.
    const settled = structuredClone(table) as { hash: string; version: number } | null;
    expect(settled?.version).toBe(4);

    // Failures are errors, never a conflict or a success, and leave the row untouched.
    for (const [failing, code] of [
      ["outage", "backend_unavailable"],
      ["redirect", "backend_unavailable"],
      ["oversized", "backend_unavailable"],
      ["malformed", "backend_unavailable"],
      ["wrong-version", "response_invalid"],
    ] as [Mode, string][]) {
      for (const expected of [2, 4]) {
        // expected=2 is a PATCH against a stale version; failure modes short-circuit before the table.
        expect((await replace("golden", expected, failing)).result, `${failing} ${expected}`).toEqual({ ok: false, code });
      }
      expect(table, failing).toEqual(settled);
    }
    expect((await replace("golden", 1, "outage")).result).toEqual({ ok: false, code: "backend_unavailable" });
    // Only 409 with 23505 on the INSERT path is a conflict; any other 409 is a backend error.
    expect((await replace("golden", 1, "other-409")).result).toEqual({ ok: false, code: "backend_unavailable" });
    expect((await replace("golden", 4, "other-409")).result).toEqual({ ok: false, code: "backend_unavailable" });
    expect((await replace("golden", 1, "wrong-version")).result).toEqual({ ok: false, code: "response_invalid" });
    expect(sinkHits).toBe(0);

    // A backend that sends headers and then stalls is cut by the shared deadline.
    const started = Date.now();
    expect((await replace("golden", 4, "hang")).result).toEqual({ ok: false, code: "backend_unavailable" });
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeGreaterThanOrEqual(9_000);
    expect(elapsedMs).toBeLessThan(30_000);
    expect(table).toEqual(settled);

    // Invalid input and bindings are rejected before any request.
    const before = requests.length;
    for (const [hash, expected] of [
      ["golden", 0], ["golden", -1], ["golden", "1.5"], ["golden", "abc"],
      ["golden", Number.MAX_SAFE_INTEGER], ["empty", 4], ["huge", 4],
    ] as [string, string | number][]) {
      expect((await replace(hash, expected)).result, `${hash} ${expected}`).toEqual({ ok: false, code: "input_invalid" });
    }
    expect((await call("/replace?hash=golden&expected=4&config=no-key")).result).toEqual({ ok: false, code: "configuration_invalid" });
    expect(requests.length).toBe(before);
    expect(table).toEqual(settled);

    // Every request: only the credential table; POST/PATCH for writes; the key in
    // `apikey` only; never in a URL or body; no Bearer for a non-JWT key; never /auth.
    for (const request of requests) {
      expect(["GET", "POST", "PATCH"]).toContain(request.method);
      expect(request.url.startsWith("/rest/v1/admin_credentials")).toBe(true);
      expect(request.apikey).toBe(FIXTURE_KEY);
      expect(request.authorization).toBeUndefined();
      expect(request.url).not.toContain(FIXTURE_KEY);
      expect(request.body).not.toContain(FIXTURE_KEY);
      if (request.method !== "GET") {
        expect(request.prefer).toBe("return=representation");
        expect(request.url).not.toContain("pbkdf2");
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(logs).toContain("/replace");
    const visible = [...bodies, logs].join("\n");
    expect(visible).not.toContain(FIXTURE_KEY);
    expect(visible).not.toMatch(/sb_secret|pbkdf2-sha256|AAECAwQF|23505|23503|duplicate key|foreign key/);
  } finally {
    for (const res of stalled) res.destroy();
    await stopWrangler(running?.child);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 240_000);

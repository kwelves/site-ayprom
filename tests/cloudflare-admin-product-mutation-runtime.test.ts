import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";

const KEY = "sb_secret_fake12";
const ID = "4d331dcf-4243-4a29-aacd-93c30af433e6";

it("runs the unchanged private product mutation ports inside local workerd", async () => {
  const calls: Array<{ pathname: string; key?: string; auth?: string; body: Record<string, unknown> }> = [];
  let mode: "ok" | "conflict" | "outage" | "malformed" = "ok";
  let sinkHits = 0;
  const backend = createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => { text += chunk; });
    req.on("end", () => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/sink") { sinkHits++; res.writeHead(200); res.end("[]"); return; }
      const body = JSON.parse(text) as Record<string, unknown>;
      calls.push({ pathname, key: req.headers.apikey as string | undefined, auth: req.headers.authorization, body });
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (mode === "outage") return send(503, { message: KEY });
      if (mode === "malformed") return send(200, [{ out_id: "bad", out_slug: "pump" }]);
      if (pathname === "/rest/v1/rpc/create_product_with_relations") {
        return send(200, [{ out_id: ID, out_slug: "pump" }]);
      }
      if (pathname === "/rest/v1/rpc/update_product_with_slug") {
        if (mode === "conflict") return send(400, { code: "55000", message: KEY });
        return send(200, [{ out_id: ID, out_updated_at: "2026-10-03T10:22:33.654321+00:00" }]);
      }
      return send(404, { message: "unexpected RPC" });
    });
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const address = backend.address();
  if (!address || typeof address === "string") throw new Error("backend address");

  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-product-mutation-runtime-"));
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-product-mutation-runtime-test",
    main: path.resolve("tests/support/product-mutation-runtime-entry.ts"),
    compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"],
    vars: { SUPABASE_URL: `http://127.0.0.1:${address.port}`, ADMIN_SUPABASE_KEY: KEY },
  }));

  let running;
  let logs = "";
  try {
    running = await startWrangler(config, directory);
    for (const stream of [running.child.stdout, running.child.stderr]) {
      stream?.on("data", (chunk) => { logs += chunk.toString(); });
    }
    const call = async (route: string) => {
      const response = await fetch(`${running!.base}${route}`);
      expect(response.status).toBe(200);
      return response.json();
    };

    expect(await call("/create")).toEqual({ ok: true, id: ID, slug: "pump" });
    expect(calls[0].pathname).toBe("/rest/v1/rpc/create_product_with_relations");
    expect(calls[0].body).toMatchObject({ p_slug_base: "pump", p_published: false, p_compatible_brands: ["man"] });
    expect(await call("/update")).toEqual({ ok: true, id: ID, updatedAt: "2026-10-03T10:22:33.654321+00:00" });
    expect(calls[1].pathname).toBe("/rest/v1/rpc/update_product_with_slug");
    expect(calls[1].body).toMatchObject({ p_slug: "pump", p_new_slug: "new-pump", p_expected_updated_at: "2026-10-01T10:22:33.123456+00:00" });

    mode = "conflict";
    expect(await call("/update")).toEqual({ ok: false, code: "conflict" });
    mode = "outage";
    expect(await call("/create")).toEqual({ ok: false, code: "backend_unavailable" });
    mode = "malformed";
    expect(await call("/create")).toEqual({ ok: false, code: "response_invalid" });

    expect(calls).toHaveLength(5);
    expect(calls.every((entry) => entry.key === KEY && entry.auth === undefined)).toBe(true);
    expect(calls.every((entry) => !entry.pathname.includes(KEY))).toBe(true);
    expect(sinkHits).toBe(0);
    expect(logs).not.toContain(KEY);
  } finally {
    await stopWrangler(running?.child);
    backend.closeAllConnections();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 90_000);

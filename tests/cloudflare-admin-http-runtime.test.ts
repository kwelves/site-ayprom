import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { startWrangler, stopWrangler } from "../scripts/cloudflare/local-admin-auth-smoke.mjs";
import { createSessionCodec } from "@/lib/admin/session-codec";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test_server_unavailable");
  return address.port;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

it("real workerd rejects redirects, oversized bodies and stalled admin backends", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-auth-http-runtime-"));
  const secret = "local-only-auth-http-workerd-test-secret";
  let sinkCalls = 0;
  let redirectPath = "";
  let fault: "redirect" | "oversized" | "stall" = "redirect";
  let credentialReads = 0;
  let faultRead = 0;
  const paths: string[] = [];
  const sink = createServer((_, res) => { sinkCalls++; res.writeHead(200); res.end("{}"); });
  const sinkPort = await listen(sink);
  const backend = createServer((req, res) => {
    const pathname = new URL(req.url!, "http://local").pathname;
    paths.push(pathname);
    if (pathname === "/rest/v1/admin_credentials") credentialReads++;
    const inject = pathname === redirectPath && (faultRead === 0 || credentialReads === faultRead);
    if (inject && fault === "redirect") {
      res.writeHead(307, { location: `http://127.0.0.1:${sinkPort}/sink` }); res.end(); return;
    }
    let payload: unknown;
    if (pathname === "/rest/v1/rpc/begin_admin_auth_attempt") payload = [{ out_allowed: true, out_retry_after: 0, out_reservation_id: "test-reservation" }];
    else if (pathname === "/rest/v1/rpc/finish_admin_auth_attempt") payload = 0;
    else if (pathname === "/rest/v1/admin_credentials") payload = [];
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    if (inject && fault === "stall") { res.write('{"unfinished":'); return; }
    res.end(JSON.stringify(payload) + (inject && fault === "oversized" ? " ".repeat(65_536) : ""));
  });
  let running;
  try {
    const backendPort = await listen(backend);
    const config = path.join(directory, "wrangler.json");
    writeFileSync(config, JSON.stringify({
      name: "ayprom-auth-http-runtime-test", main: path.resolve("src/cloudflare/worker.ts"), compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"],
      assets: { directory: path.resolve("fixtures/cloudflare-admin-assets"), binding: "ASSETS", run_worker_first: ["/api/*", "/admin", "/admin/*"] },
      vars: { SUPABASE_URL: `http://127.0.0.1:${backendPort}`, SUPABASE_PUBLISHABLE_KEY: "test-public", ADMIN_SUPABASE_KEY: "test-private", ADMIN_PASSWORD: "local-only-test-password", ADMIN_COOKIE_HMAC_KEY: secret, ADMIN_CRYPTO_KEY: "local-only-http-runtime-crypto-secret-123456" },
    }));
    running = await startWrangler(config, directory);
    const login = () => {
      credentialReads = 0;
      return fetch(`${running!.base}/api/admin/login`, {
      method: "POST", redirect: "manual", headers: { origin: running!.base, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "local-only-test-password" }),
      });
    };
    // Establish a successful baseline before fault injection.
    const success = await login();
    expect(success.status).toBe(303);
    expect(success.headers.get("location")).toBe("/admin");
    expect(success.headers.get("set-cookie")).toContain("admin_session=");
    for (const injected of ["redirect", "oversized"] as const) {
      fault = injected;
      for (const pathname of ["/rest/v1/rpc/begin_admin_auth_attempt", "/rest/v1/rpc/finish_admin_auth_attempt", "/rest/v1/admin_credentials"]) {
        redirectPath = pathname;
        // Protect both the password-state read and the post-finish version read.
        for (const read of pathname === "/rest/v1/admin_credentials" ? [1, 2] : [0]) {
          faultRead = read;
          const response = await login();
          expect(response.status).toBe(303);
          expect(response.headers.get("location")).toBe("/admin/login?error=security");
          expect(response.headers.get("set-cookie")).toBeNull();
        }
      }
    }
    faultRead = 0;
    fault = "stall";
    redirectPath = "/rest/v1/rpc/finish_admin_auth_attempt";
    const stalled = await login();
    expect(stalled.headers.get("location")).toBe("/admin/login?error=security");
    expect(stalled.headers.get("set-cookie")).toBeNull();
    fault = "redirect";
    redirectPath = "/rest/v1/admin_credentials";
    const token = await createSessionCodec(secret, Date.now).create();
    const denied = await fetch(`${running.base}/api/admin/products`, { headers: { cookie: `admin_session=${token}` } });
    expect(denied.status).toBe(503);
    expect(sinkCalls).toBe(0);
    expect(paths.some((pathname) => pathname.startsWith("/auth/"))).toBe(false);
  } finally {
    await stopWrangler(running?.child);
    await close(backend);
    await close(sink);
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 90_000);

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { parseReadyUrl } from "../scripts/cloudflare/worker-smoke-lib.mjs";

const SHELL = "ADMIN_SHELL_SECRET_MARKER";
const LOGIN = "ADMIN_LOGIN_PAGE_MARKER";
const WRANGLER = path.resolve(".wrangler/tools/wrangler-4.135.0/node_modules/wrangler/bin/wrangler.js");
const ASSETS = path.resolve("fixtures/cloudflare-admin-route-boundary");

function assertNoProtectedShell(body: string) {
  if (body.includes(SHELL)) throw new Error("protected_shell_exposed");
}

function clientNormalizedPath(requestPath: string): string | null {
  try {
    const parsed = new URL(requestPath, "http://127.0.0.1");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

it("catches an open protected file instead of trusting the status alone", () => {
  const openShell = readFileSync(path.join(ASSETS, "admin/index.html"), "utf8");
  expect(openShell).toContain(SHELL);
  expect(() => assertNoProtectedShell(openShell)).toThrow("protected_shell_exposed");
  expect(() => assertNoProtectedShell("Обычный отказ")).not.toThrow();
});

it("keeps admin files closed on local workerd without a session", async () => {
  expect(readFileSync(WRANGLER, "utf8").length).toBeGreaterThan(0);
  const directory = mkdtempSync(path.join(tmpdir(), "ayprom-admin-route-boundary-"));
  const seenByBackend: string[] = [];
  const backend = createServer((req, res) => {
    seenByBackend.push(req.url ?? "");
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const address = backend.address();
  if (!address || typeof address === "string") throw new Error("backend_unavailable");
  const config = path.join(directory, "wrangler.json");
  writeFileSync(config, JSON.stringify({
    name: "ayprom-admin-route-boundary",
    main: path.resolve("src/cloudflare/worker.ts"),
    compatibility_date: "2026-09-19",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    assets: {
      directory: ASSETS,
      binding: "ASSETS",
      html_handling: "drop-trailing-slash",
      not_found_handling: "404-page",
      run_worker_first: ["/api/*", "/product/*", "/admin", "/admin/*"],
    },
    vars: {
      SUPABASE_URL: `http://127.0.0.1:${address.port}`,
      SUPABASE_PUBLISHABLE_KEY: "local-boundary-publishable",
      ADMIN_SUPABASE_KEY: "local-boundary-private",
      ADMIN_COOKIE_HMAC_KEY: "local-boundary-hmac-key",
      ADMIN_CRYPTO_KEY: "local-boundary-crypto-secret-with-enough-entropy-123456",
    },
  }));
  let child: ChildProcess | undefined;
  let logs = "";
  try {
    const worker = spawn(process.execPath, [
      WRANGLER, "dev", "--local", "--config", config,
      "--ip", "127.0.0.1", "--port", "0",
      "--inspector-ip", "127.0.0.1", "--inspector-port", "0",
      "--persist-to", path.join(directory, "state"),
      "--show-interactive-dev-session=false", "--log-level", "info",
    ], {
      cwd: path.resolve("."),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "",
        SYSTEMROOT: process.env.SYSTEMROOT ?? "",
        TEMP: process.env.TEMP ?? "",
        TMP: process.env.TMP ?? "",
        PATHEXT: process.env.PATHEXT ?? "",
        COMSPEC: process.env.COMSPEC ?? "",
        CI: "1",
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_SEND_ERROR_REPORTS: "false",
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
      } as unknown as NodeJS.ProcessEnv,
    });
    child = worker;
    worker.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    worker.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    const base = await waitUntilReady(worker, () => logs);
    const probes = [
      ["GET", "/admin"],
      ["GET", "/admin/products"],
      ["GET", "/admin/index.html"],
      ["GET", "/admin/login.html"],
      ["GET", "/admin/Index.html"],
      ["GET", "/ADMIN/index.html"],
      ["GET", "/admin/index.html?q=secret-query"],
      ["GET", "/admin/./index.html"],
      ["GET", "/admin/../admin/index.html"],
      ["GET", "//admin/index.html"],
      ["GET", "/admin//index.html"],
      ["GET", "/admin/%2e%2e/admin/index.html"],
      ["GET", "/admin/%69ndex.html"],
      ["GET", "/admin%2findex.html"],
      ["HEAD", "/admin"],
      ["HEAD", "/admin/index.html"],
      ["POST", "/admin"],
      ["POST", "/admin/index.html"],
    ] as const;
    const observations: string[] = [];
    for (const [method, requestPath] of probes) {
      const response = await rawRequest(base, method, requestPath);
      observations.push(`${method} ${requestPath} -> ${response.status} ${response.location}; client-url ${clientNormalizedPath(requestPath) ?? "unparsed"}`);
      assertNoProtectedShell(response.body);
      expect(response.body).not.toContain("secret-query");
      if (response.status >= 300 && response.status < 400 && response.location.startsWith("/")) {
        const followed = await rawRequest(base, "GET", response.location);
        assertNoProtectedShell(followed.body);
        expect(followed.body).not.toContain(SHELL);
      }
      if (requestPath === "/admin/index.html" || requestPath === "/admin/login.html") {
        expect(response.status).not.toBe(200);
        expect(response.body).not.toContain(LOGIN);
      }
    }
    const login = await rawRequest(base, "GET", "/admin/login");
    expect(login.status).toBe(200);
    expect(login.body).toContain(LOGIN);
    assertNoProtectedShell(login.body);
    const health = await rawRequest(base, "GET", "/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toContain("\"status\":\"ok\"");
    assertNoProtectedShell(health.body);
    expect(seenBackendAdminFiles(seenByBackend)).toBe(false);
    expect(observations.length).toBe(probes.length);
    expect(observations.join("\n")).toContain("GET /admin/index.html");
  } finally {
    await stopChild(child);
    await closeServer(backend);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }
}, 90_000);

function seenBackendAdminFiles(urls: string[]): boolean {
  return urls.some((url) => url.includes("ADMIN_SHELL") || url.includes("/admin/index.html"));
}

function rawRequest(base: string, method: string, requestPath: string): Promise<{ status: number; body: string; location: string }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      method,
      path: requestPath,
      headers: { host: url.host },
    }, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
        location: String(response.headers.location ?? ""),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitUntilReady(child: ChildProcess, logs: () => string): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && child.exitCode === null) {
    const base = parseReadyUrl(logs());
    if (base) {
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
        if (response.status === 200) return base;
      } catch { /* listener may start slightly later */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("workerd_not_ready");
}

async function stopChild(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  const stopped = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3000))]);
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  } else if (!stopped && child.pid) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

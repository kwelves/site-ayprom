import { readFile } from "node:fs/promises";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("local-only admin HTML fixtures", () => {
  it("has a no-JavaScript, same-origin password form and no embedded credentials", async () => {
    const html = await readFile(path.join(root, "fixtures/cloudflare-admin-assets/admin/login.html"), "utf8");
    expect(html).toMatch(/<form\b[^>]*method="post"[^>]*action="\/api\/admin\/login"/i);
    expect(html).toMatch(/<input\b[^>]*name="password"[^>]*type="password"/i);
    expect(html).toContain("<!-- AUTH_MESSAGE -->");
    expect(html).not.toMatch(/<script\b|\s+on[a-z]+\s*=|supabase|secret|token|localStorage|sessionStorage/i);
  });

  it("has a static empty shell with a no-JavaScript logout form", async () => {
    const html = await readFile(path.join(root, "fixtures/cloudflare-admin-assets/admin/index.html"), "utf8");
    expect(html).toMatch(/<form\b[^>]*method="post"[^>]*action="\/api\/admin\/logout"/i);
    expect(html).toContain('href="/admin/products"');
    expect(html).not.toMatch(/<script\b|\s+on[a-z]+\s*=|supabase|secret|token|localStorage|sessionStorage/i);
  });

  it("offers a fixture-only check without starting services or exposing values", () => {
    const stdout = execFileSync(process.execPath, ["scripts/cloudflare/local-admin-auth-smoke.mjs", "--fixtures-only"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(JSON.parse(stdout)).toEqual({ ok: true, mode: "fixtures-only", login: true, shell: true });
  });

  it("stops an owned Wrangler child when readiness times out", async () => {
    const { startWrangler } = await import("@/../scripts/cloudflare/local-admin-auth-smoke.mjs");
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      await expect(startWrangler("unused-config", root, {
        readyTimeoutMs: 50,
        spawnProcess: (() => {
          child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
          });
          return child;
        }) as unknown as typeof spawn,
      })).rejects.toThrow("workerd_not_ready");
      expect(child).toBeDefined();
      expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill();
    }
  }, 10_000);
});

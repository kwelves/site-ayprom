import { mkdtempSync, mkdirSync, writeFileSync, rmSync, type PathLike, type Stats } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectPackageInventory } from "../scripts/cloudflare/package-integrity.mjs";
import { readAdminPreviewRuntime } from "../scripts/cloudflare/admin-preview-runtime.mjs";

const directories: string[] = [];
function fixture(patch = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ayprom-preview-runtime-"));
  directories.push(root);
  mkdirSync(path.join(root, "site"));
  writeFileSync(path.join(root, "site", "index.html"), "<p>preview</p>");
  writeFileSync(path.join(root, "worker.js"), "export default {};");
  writeFileSync(path.join(root, "wrangler.jsonc"), JSON.stringify({
    main: "worker.js", compatibility_date: "2026-09-19", compatibility_flags: ["nodejs_compat"], workers_dev: false,
    assets: { directory: "site", binding: "ASSETS", html_handling: "drop-trailing-slash", not_found_handling: "404-page", run_worker_first: ["/api/*", "/product/*", "/admin", "/admin/*"] },
    ...patch,
  }));
  const inventory = collectPackageInventory(root);
  writeFileSync(path.join(root, "package-manifest.json"), JSON.stringify({ kind: "admin-preview", ready: false, previewReady: true, productionReady: false, inventory: inventory.inventory }));
  return root;
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("uses the packaged entry and assets, never repository sources", () => {
  const root = fixture();
  const config = readAdminPreviewRuntime(root);
  expect(config.main).toBe(path.join(root, "worker.js"));
  expect(config.assets.directory).toBe(path.join(root, "site"));
  expect(config.assets.run_worker_first).toContain("/admin/*");
  expect(config).not.toHaveProperty("vars");
});
it.each([{ main: "../../src/worker.ts" }, { vars: { ADMIN_COOKIE_HMAC_KEY: "never_echo_me" } }, { assets: { directory: "site" } }])("rejects unsafe or unguarded package configuration", (patch) => {
  expect(() => readAdminPreviewRuntime(fixture(patch))).toThrow("invalid_admin_preview");
});
it("rejects public release flags", () => {
  const root = fixture();
  writeFileSync(path.join(root, "package-manifest.json"), JSON.stringify({ ready: true }));
  expect(() => readAdminPreviewRuntime(root)).toThrow("invalid_admin_preview");
});
it("does not read oversized preview metadata", async () => {
  const root = fixture();
  const mod = await import("../scripts/cloudflare/package-integrity.mjs");
  const limit = mod.METADATA_READ_LIMIT_BYTES;
  const reads: string[] = [];
  const realLstat = fs.lstatSync;
  const realRead = fs.readFileSync;
  mod.useIntegrityIoForTests({
    lstatSync(target: PathLike) {
      const stat = realLstat(target);
      if (String(target).endsWith(`${path.sep}package-manifest.json`) || String(target).endsWith(`${path.sep}wrangler.jsonc`)) {
        return new Proxy(stat, {
          get(obj: Stats, prop: string | symbol, receiver) {
            if (prop === "size") return limit + 1;
            const value: unknown = Reflect.get(obj, prop, receiver);
            return typeof value === "function" ? value.bind(obj) : value;
          },
        });
      }
      return stat;
    },
    readFileSync(target: PathLike) {
      reads.push(String(target));
      return realRead(target);
    },
  });
  try {
    expect(() => readAdminPreviewRuntime(root)).toThrow("package_integrity_failed");
    expect(reads.some((item) => item.endsWith("package-manifest.json") || item.endsWith("wrangler.jsonc"))).toBe(false);
  } finally {
    mod.useIntegrityIoForTests(null);
  }
});

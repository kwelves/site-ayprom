import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = path.resolve(import.meta.dirname, "..");
const script = path.join(repo, "scripts/cloudflare/local-revisioned-static-build.mjs");
const packageScript = path.join(repo, "scripts/cloudflare/package-worker-assets.mjs");

describe("local revisioned build command", () => {
  it("rejects remote Supabase before starting a build and never prints the key", () => {
    const key = "sb_publishable_not_for_remote_diagnostic";
    const result = spawnSync(process.execPath, [script], {
      cwd: repo,
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      },
      encoding: "utf8", timeout: 15_000, windowsHide: true,
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      kind: "local-revisioned-static-build", ok: false, code: "local_probe_invalid_binding", stage: "preflight", stagingDir: null,
    });
    expect(result.stdout + result.stderr).not.toContain(key);
  });
});

it("does not package with a remote catalog revision source", () => {
  const key = "sb_publishable_not_for_remote_package";
  const result = spawnSync(process.execPath, [packageScript, "--staging", "dist/staging/missing", "--package", "dist/worker-packages/nope"], {
    cwd: repo,
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key },
    encoding: "utf8", timeout: 15_000, windowsHide: true,
  });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: false, ready: false, code: "local_probe_invalid_binding" });
  expect(result.stdout + result.stderr).not.toContain(key);
});

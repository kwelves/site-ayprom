import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempRepo, removeTempRepo } from "./cloudflare-static-producer-support";

const CLI = path.resolve("scripts/cloudflare/static-producer-fixture.mjs");

let repo: ReturnType<typeof makeTempRepo>;
beforeEach(() => {
  repo = makeTempRepo();
});
afterEach(() => {
  removeTempRepo(repo.repoRoot);
});

function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    // Deliberately minimal: the CLI must not depend on the developer's env file or shell.
    env: Object.fromEntries(
      Object.entries({
        PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP,
      }).filter((pair): pair is [string, string] => pair[1] !== undefined),
    ) as NodeJS.ProcessEnv,
  });
}

describe("static producer fixture CLI", { timeout: 30_000 }, () => {
  it("produces a staging crawl of the checked-in fixture snapshot with one command", () => {
    const before = repo.siteSnapshot();
    const result = runCli(["--repo-root", repo.repoRoot, "--git-sha", "d6bdc4586786f01a843a657e266488bbbfc35d82"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const summary = JSON.parse(result.stdout.trim().split("\n").at(-1)!) as {
      ok: boolean; stagingDir: string; reportPath: string; summary: { routes: number; written: number; failed: number; pendingAliases: number };
    };
    expect(summary.ok).toBe(true);
    expect(summary.summary.failed).toBe(0);
    expect(summary.summary.written).toBe(summary.summary.routes);
    expect(summary.summary.pendingAliases).toBe(2);

    const siteDir = path.join(summary.stagingDir, "site");
    expect(path.relative(path.join(repo.repoRoot, "dist", "staging"), summary.stagingDir)).not.toMatch(/^\.\./);
    for (const file of [
      "index.html", "catalog.html", "about.html", "contacts.html", "404.html", "robots.txt", "sitemap.xml",
      "catalog/category/fittings/seal-24.html",
      "catalog/category/pto/brand/kamaz/pto-shaft-110.html",
      "catalog/category/pto/brand/shacman/pto-shaft-110.html",
    ]) {
      expect(existsSync(path.join(siteDir, file)), file).toBe(true);
    }
    expect(existsSync(path.join(siteDir, "product"))).toBe(false);
    expect(existsSync(path.join(siteDir, "_next"))).toBe(false);
    expect(existsSync(summary.reportPath)).toBe(true);
    expect(readFileSync(summary.reportPath, "utf8")).not.toMatch(/127\.0\.0\.1|localhost/);

    expect(repo.siteSnapshot()).toEqual(before);
    expect(readdirSync(path.join(repo.repoRoot, "dist", "staging"))).toHaveLength(1);
  });

  it("copies an explicit next static directory when asked and still omits it otherwise", () => {
    const before = repo.siteSnapshot();
    const result = runCli([
      "--repo-root", repo.repoRoot,
      "--git-sha", "0ee6041d34dc407b7cb067a8828d7fc417f3e5a2",
      "--next-static", path.resolve("fixtures/cloudflare-static-producer/next-static"),
    ]);
    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout.trim().split("\n").at(-1)!) as {
      ok: boolean; stagingDir: string; staticFileCount?: number;
    };
    expect(summary.ok).toBe(true);
    expect(summary.staticFileCount).toBe(3);
    const siteDir = path.join(summary.stagingDir, "site");
    expect(readFileSync(path.join(siteDir, "_next/static/chunks/app.js"), "utf8")).toBe(
      readFileSync(path.resolve("fixtures/cloudflare-static-producer/next-static/chunks/app.js"), "utf8"),
    );
    expect(existsSync(path.join(siteDir, "_next/server"))).toBe(false);
    expect(repo.siteSnapshot()).toEqual(before);
  });

  it("exits non-zero with a stable code when the fixture server is forced to fail", () => {
    const result = runCli([
      "--repo-root", repo.repoRoot, "--git-sha", "d6bdc4586786f01a843a657e266488bbbfc35d82",
      "--server-arg", "--status", "--server-arg", "/catalog=500",
    ]);
    expect(result.status).toBe(1);
    const summary = JSON.parse(result.stdout.trim().split("\n").at(-1)!) as { ok: boolean; code: string };
    expect(summary).toMatchObject({ ok: false, code: "crawl_failed" });
  });
});

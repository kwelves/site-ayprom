import { describe, expect, it } from "vitest";
import { runRevisionedStaticBuild } from "@/cloudflare/static-build/producer/revisioned-build";
import { localProbeBindings } from "@/cloudflare/static-build/local-browser-probe";
import { validateStaticBuildPreflight } from "@/cloudflare/static-build/preflight";
import { fixturePreflight, makeTempRepo, removeTempRepo } from "./cloudflare-static-producer-support";

describe("local revisioned static build coordinator", () => {
  it("checks the same revision before build, after build, and after crawl", async () => {
    const events: string[] = [];
    const result = await runRevisionedStaticBuild({
      readRevision: async () => { events.push("read"); return 12; },
      buildStaticFiles: async () => { events.push("build"); return true; },
      crawlToStaging: async () => { events.push("crawl"); return { ok: true, stagingDir: "dist/staging/one" }; },
    });
    expect(result).toEqual({ ok: true, revision: 12, stagingDir: "dist/staging/one" });
    expect(events).toEqual(["read", "build", "read", "crawl", "read"]);
  });

  it("does not build when the first revision is unavailable or malformed", async () => {
    for (const readRevision of [async () => { throw new Error("backend secret"); }, async () => -1]) {
      const events: string[] = [];
      const result = await runRevisionedStaticBuild({
        readRevision,
        buildStaticFiles: async () => { events.push("build"); return true; },
        crawlToStaging: async () => { events.push("crawl"); return { ok: true, stagingDir: "unexpected" }; },
      });
      expect(result).toEqual({ ok: false, code: "publication_revision_unavailable", stage: "before_build", stagingDir: null });
      expect(events).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("backend secret");
    }
  });

  it("rejects a changed revision after build without starting crawl", async () => {
    const events: string[] = [];
    const values = [4, 5];
    const result = await runRevisionedStaticBuild({
      readRevision: async () => values.shift()!,
      buildStaticFiles: async () => { events.push("build"); return true; },
      crawlToStaging: async () => { events.push("crawl"); return { ok: true, stagingDir: "unexpected" }; },
    });
    expect(result).toEqual({ ok: false, code: "publication_revision_changed", stage: "after_build", stagingDir: null });
    expect(events).toEqual(["build"]);
  });

  it("rejects a changed revision after crawl and retains only the staging path", async () => {
    const values = [8, 8, 9];
    const result = await runRevisionedStaticBuild({
      readRevision: async () => values.shift()!,
      buildStaticFiles: async () => true,
      crawlToStaging: async () => ({ ok: true, stagingDir: "dist/staging/stale" }),
    });
    expect(result).toEqual({ ok: false, code: "publication_revision_changed", stage: "after_crawl", stagingDir: "dist/staging/stale" });
  });

  it("fails closed when either later revision read fails", async () => {
    for (const [values, stage, stagingDir] of [
      [[2, null], "after_build", null],
      [[2, 2, null], "after_crawl", "dist/staging/one"],
    ] as const) {
      const queue: (number | null)[] = [...values];
      const result = await runRevisionedStaticBuild({
        readRevision: async () => { const value = queue.shift(); if (value === null) throw new Error("backend secret"); return value!; },
        buildStaticFiles: async () => true,
        crawlToStaging: async () => ({ ok: true, stagingDir: "dist/staging/one" }),
      });
      expect(result).toEqual({ ok: false, code: "publication_revision_unavailable", stage, stagingDir });
      expect(JSON.stringify(result)).not.toContain("backend secret");
    }
  });

  it("never crawls after a failed build and does not declare failed crawl successful", async () => {
    const events: string[] = [];
    const failedBuild = await runRevisionedStaticBuild({
      readRevision: async () => 1,
      buildStaticFiles: async () => { throw new Error("build secret"); },
      crawlToStaging: async () => { events.push("crawl"); return { ok: true, stagingDir: "unexpected" }; },
    });
    expect(failedBuild).toEqual({ ok: false, code: "static_build_failed", stage: "build", stagingDir: null });
    expect(events).toEqual([]);
    const failedCrawl = await runRevisionedStaticBuild({
      readRevision: async () => 1,
      buildStaticFiles: async () => true,
      crawlToStaging: async () => ({ ok: false, stagingDir: "dist/staging/failed" }),
    });
    expect(failedCrawl).toEqual({ ok: false, code: "crawl_failed", stage: "crawl", stagingDir: "dist/staging/failed" });
  });
});

it("allows only the owned isolated Supabase loopback port in diagnostic mode", () => {
  const key = "sb_publishable_local_test";
  expect(localProbeBindings("http://127.0.0.1:56421", key)).toEqual({
    SUPABASE_URL: "http://127.0.0.1:56421", SUPABASE_PUBLISHABLE_KEY: key,
  });
  const repo = makeTempRepo();
  try {
    const preflight = fixturePreflight(repo.repoRoot, repo.stagingRoot);
    preflight.sourceMode = "local-snapshot";
    preflight.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:56421";
    preflight.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
    expect(validateStaticBuildPreflight(preflight).ok).toBe(true);
  } finally { removeTempRepo(repo.repoRoot); }
  expect(() => localProbeBindings("https://project.supabase.co", key)).toThrow("local_probe_invalid_binding");
});

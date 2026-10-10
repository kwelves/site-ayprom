import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStaticProducer } from "@/cloudflare/static-build/producer/run";
import { fixtureProducerInput, makeTempRepo, removeTempRepo } from "./cloudflare-static-producer-support";

// Windows directory junctions (and POSIX directory symlinks). File symlinks are
// not required: the reproduced escapes are directory reparse points.
const linkType = process.platform === "win32" ? "junction" : "dir";

let repo: ReturnType<typeof makeTempRepo>;
let previousSite: Record<string, string>;
const extraDirs: string[] = [];
const junctions: string[] = [];

beforeEach(() => {
  repo = makeTempRepo();
  previousSite = repo.siteSnapshot();
});

afterEach(() => {
  for (const link of junctions.reverse()) {
    try {
      unlinkSync(link);
    } catch {
      // Already removed with its parent.
    }
  }
  junctions.length = 0;
  for (const directory of extraDirs.reverse()) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  extraDirs.length = 0;
  removeTempRepo(repo.repoRoot);
});

function outsideDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ayprom-staging-outside-"));
  extraDirs.push(directory);
  return directory;
}

function linkJunction(target: string, link: string) {
  symlinkSync(target, link, linkType);
  junctions.push(link);
}

function names(directory: string): string[] {
  try {
    return readdirSync(directory).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

describe("static producer staging root boundaries", () => {
  it("rejects a staging root whose real path leaves dist through a junction", async () => {
    const outside = outsideDir();
    linkJunction(outside, repo.stagingRoot);
    const marker = path.join(outside, "spawned.txt");

    const result = await runStaticProducer(fixtureProducerInput(repo, {
      server: {
        command: process.execPath,
        args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "spawned")`],
        cwd: repo.repoRoot,
        readyPattern: /Ready on (\S+)/,
      },
    }));

    expect(result).toMatchObject({
      ok: false,
      code: "artifact_policy_failed",
      stagingDir: null,
      childPid: null,
      issues: [{ field: "outputRoot", rule: "outside_dist_realpath" }],
    });
    expect(names(outside)).toEqual([]);
    expect(repo.siteSnapshot()).toEqual(previousSite);
  });

  it("rejects a junction at dist itself before creating a staging directory", async () => {
    unlinkSync(path.join(repo.repoRoot, "dist", "site", "catalog", "brand.html"));
    rmSync(path.join(repo.repoRoot, "dist"), { recursive: true, force: true });
    const outside = outsideDir();
    linkJunction(outside, path.join(repo.repoRoot, "dist"));

    const result = await runStaticProducer(fixtureProducerInput(repo));

    expect(result).toMatchObject({
      ok: false,
      code: "artifact_policy_failed",
      stagingDir: null,
      issues: [{ field: "outputRoot", rule: "outside_dist_realpath" }],
    });
    expect(names(outside)).toEqual([]);
  });

  it("rejects a junction on an intermediate directory of the staging root", async () => {
    const outside = outsideDir();
    const intermediate = path.join(repo.repoRoot, "dist", "level");
    linkJunction(outside, intermediate);
    const input = fixtureProducerInput(repo);
    input.preflight.outputRoot = path.join(intermediate, "deeper");

    const result = await runStaticProducer(input);

    expect(result).toMatchObject({
      ok: false,
      code: "artifact_policy_failed",
      stagingDir: null,
      issues: [{ field: "outputRoot", rule: "outside_dist_realpath" }],
    });
    expect(names(outside)).toEqual([]);
    expect(repo.siteSnapshot()).toEqual(previousSite);
  });

  it("rejects dist/site and a descendant as the staging root without changing it", async () => {
    const siteRoot = path.join(repo.repoRoot, "dist", "site");
    const nested = path.join(siteRoot, "nested");
    mkdirSync(nested);
    writeFileSync(path.join(nested, "marker.txt"), "keep");
    const before = repo.siteSnapshot();
    const beforeNames = names(siteRoot);

    for (const outputRoot of [siteRoot, nested, path.join(repo.repoRoot, "dist", "Site")]) {
      const input = fixtureProducerInput(repo);
      input.preflight.outputRoot = outputRoot;
      const result = await runStaticProducer(input);
      expect(result).toMatchObject({
        ok: false,
        code: "artifact_policy_failed",
        stagingDir: null,
        childPid: null,
        issues: [{ field: "outputRoot", rule: "site_tree_forbidden" }],
      });
    }

    expect(repo.siteSnapshot()).toEqual(before);
    expect(names(siteRoot)).toEqual(beforeNames);
  });

  it("rejects a staging alias that resolves to dist/site", async () => {
    const siteRoot = path.join(repo.repoRoot, "dist", "site");
    linkJunction(siteRoot, repo.stagingRoot);
    const before = repo.siteSnapshot();

    const result = await runStaticProducer(fixtureProducerInput(repo));

    expect(result).toMatchObject({
      ok: false,
      code: "artifact_policy_failed",
      stagingDir: null,
      issues: [{ field: "outputRoot", rule: "site_tree_forbidden" }],
    });
    expect(repo.siteSnapshot()).toEqual(before);
    expect(names(siteRoot)).toEqual(["catalog", "catalog.html", "index.html"]);
  });

  it("accepts an ordinary staging directory and keeps it inside the real dist", async () => {
    const result = await runStaticProducer(fixtureProducerInput(repo));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const realDist = realpathSync(path.join(repo.repoRoot, "dist"));
    const realStaging = realpathSync(result.stagingDir);
    const relative = path.relative(realDist, realStaging);
    expect(relative === "" || relative.startsWith("..") || path.isAbsolute(relative)).toBe(false);
    expect(lstatSync(repo.stagingRoot).isSymbolicLink()).toBe(false);
    expect(repo.siteSnapshot()).toEqual(previousSite);
  });
});

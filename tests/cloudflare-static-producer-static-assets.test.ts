import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STATIC_ASSET_MAX_FILE_BYTES } from "@/cloudflare/static-build/artifact-policy";
import { runStaticProducer } from "@/cloudflare/static-build/producer/run";
import {
  readNextStaticAssets,
  staticAssetReport,
  staticOutputFile,
  writeNextStaticAssets,
} from "@/cloudflare/static-build/producer/static-assets";
import { createStagingDirectory } from "@/cloudflare/static-build/producer/staging";
import { fixtureProducerInput, makeTempRepo } from "./cloudflare-static-producer-support";

const linkType = process.platform === "win32" ? "junction" : "dir";
const checkedInStatic = path.resolve("fixtures/cloudflare-static-producer/next-static");
const temps: string[] = [];

afterEach(() => {
  for (const directory of temps.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ayprom-next-static-"));
  temps.push(directory);
  return directory;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("next static asset paths", () => {
  it.each(["chunks/nul.js", "chunks/COM1.txt", "../secret.js", "chunks/a:b.js", "chunks//app.js"])(
    "rejects an unsafe relative path %s",
    (relativePath) => {
      expect(() => staticOutputFile(relativePath)).toThrow(expect.objectContaining({
        code: "artifact_policy_failed",
        issues: [expect.objectContaining({ rule: "invalid_path" })],
      }));
    },
  );

  it("keeps a portable path under _next/static", () => {
    expect(staticOutputFile("chunks/app.js")).toBe("_next/static/chunks/app.js");
  });
});

describe("next static asset copy", { timeout: 20_000 }, () => {
  it("copies js, css and font bytes to the same relative paths and hashes them stably", async () => {
    const site = path.join(tempDir(), "site");
    mkdirSync(site);
    const planned = await readNextStaticAssets(checkedInStatic);
    await writeNextStaticAssets(site, planned);
    const report = staticAssetReport(planned);

    expect(report.files.map((file) => file.path)).toEqual([
      "_next/static/chunks/app.css",
      "_next/static/chunks/app.js",
      "_next/static/media/font.woff2",
    ]);
    expect(report.fileCount).toBe(3);
    expect(report.totalBytes).toBe(report.files.reduce((sum, file) => sum + file.bytes, 0));
    for (const file of report.files) {
      const written = readFileSync(path.join(site, file.path));
      const source = readFileSync(path.join(checkedInStatic, file.path.slice("_next/static/".length)));
      expect(Buffer.compare(written, source)).toBe(0);
      expect(file.sha256).toBe(sha256(written));
      expect(file.bytes).toBe(written.byteLength);
    }
    expect(staticAssetReport(await readNextStaticAssets(checkedInStatic))).toEqual(report);
  });

  it("accepts an empty static tree and writes nothing", async () => {
    const source = path.join(tempDir(), "static");
    const site = path.join(tempDir(), "site");
    mkdirSync(source);
    mkdirSync(site);
    const planned = await readNextStaticAssets(source);
    await writeNextStaticAssets(site, planned);
    expect(staticAssetReport(planned)).toEqual({ fileCount: 0, totalBytes: 0, files: [] });
    expect(existsSync(path.join(site, "_next"))).toBe(false);
  });

  it("does not copy sibling server or cache directories", async () => {
    const root = tempDir();
    const source = path.join(root, ".next", "static");
    mkdirSync(path.join(source, "chunks"), { recursive: true });
    writeFileSync(path.join(source, "chunks", "app.js"), "console.log('keep');\n");
    mkdirSync(path.join(root, ".next", "server"), { recursive: true });
    mkdirSync(path.join(root, ".next", "cache"), { recursive: true });
    writeFileSync(path.join(root, ".next", "server", "page.js"), "SHOULD_NOT_COPY_SERVER");
    writeFileSync(path.join(root, ".next", "cache", "data.json"), "SHOULD_NOT_COPY_CACHE");

    const planned = await readNextStaticAssets(source);
    expect(planned.map((asset) => asset.outputFile)).toEqual(["_next/static/chunks/app.js"]);
    expect(planned.some((asset) => Buffer.from(asset.bytes).toString("utf8").includes("SHOULD_NOT_COPY"))).toBe(false);
  });

  it("rejects a source map, an rsc payload and a secret without echoing the secret", async () => {
    const source = path.join(tempDir(), "static");
    mkdirSync(path.join(source, "chunks"), { recursive: true });
    const secret = "super-secret-value";
    writeFileSync(path.join(source, "chunks", "app.js"), `const key = "SUPABASE_SECRET_KEY=${secret}";\n`);
    writeFileSync(path.join(source, "chunks", "app.js.map"), "{}");
    writeFileSync(path.join(source, "chunks", "page.rsc"), "payload");

    let thrown: unknown;
    try {
      await readNextStaticAssets(source);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: "artifact_policy_failed",
      issues: expect.arrayContaining([
        expect.objectContaining({ field: "_next/static/chunks/app.js", rule: "forbidden_content" }),
        expect.objectContaining({ field: "_next/static/chunks/app.js.map", rule: "forbidden_path" }),
        expect.objectContaining({ field: "_next/static/chunks/page.rsc", rule: "forbidden_path" }),
      ]),
    });
    expect(JSON.stringify(thrown)).not.toContain(secret);
  });

  it("rejects a case collision with an already reserved document path", async () => {
    const source = path.join(tempDir(), "static", "chunks");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "app.js"), "console.log('copy');\n");

    await expect(readNextStaticAssets(path.dirname(source), ["_next/static/chunks/App.js"])).rejects.toMatchObject({
      code: "artifact_policy_failed",
      issues: [expect.objectContaining({
        field: "_next/static/chunks/app.js",
        rule: "case_insensitive_collision",
      })],
    });
  });

  it("rejects a junction in a parent of the source before reading its files", async () => {
    const root = tempDir();
    const outside = path.join(root, "outside");
    const staticDir = path.join(outside, "nested", "static", "chunks");
    mkdirSync(staticDir, { recursive: true });
    const secret = "SHOULD_NOT_READ_PARENT_JUNCTION";
    writeFileSync(path.join(staticDir, "app.js"), secret);
    const link = path.join(root, "linked-parent");
    symlinkSync(outside, link, linkType);
    // `nested` and `static` are real directories. The junction is an earlier parent.
    const source = path.join(link, "nested", "static");

    try {
      let thrown: unknown;
      try {
        await readNextStaticAssets(source);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        code: "artifact_policy_failed",
        reason: "static_source_escape",
        issues: [expect.objectContaining({ field: "nextStaticDir", rule: "outside_source_realpath" })],
      });
      expect(JSON.stringify(thrown)).not.toContain(secret);
    } finally {
      unlinkSync(link);
    }
  });

  it("rejects a junction that points outside the source and does not read it", async () => {
    const root = tempDir();
    const source = path.join(root, "static");
    const outside = path.join(root, "outside");
    mkdirSync(path.join(source, "chunks"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(path.join(source, "chunks", "app.js"), "console.log('keep');\n");
    writeFileSync(path.join(outside, "secret.js"), "SHOULD_NOT_COPY_OUTSIDE");
    symlinkSync(outside, path.join(source, "escaped"), linkType);

    await expect(readNextStaticAssets(source)).rejects.toMatchObject({
      code: "artifact_policy_failed",
      issues: [expect.objectContaining({ rule: "outside_source_realpath" })],
    });
    expect(JSON.stringify(await import("node:fs").then(() => readdirSync(outside)))).not.toContain("SHOULD_NOT_COPY_OUTSIDE");
    expect(readFileSync(path.join(outside, "secret.js"), "utf8")).toBe("SHOULD_NOT_COPY_OUTSIDE");
  });

  it("rejects a file above the artifact size limit before copying the rest", async () => {
    const source = path.join(tempDir(), "static");
    const site = path.join(tempDir(), "site");
    mkdirSync(path.join(source, "chunks"), { recursive: true });
    mkdirSync(site);
    writeFileSync(path.join(source, "chunks", "app.js"), "console.log('keep');\n");
    writeFileSync(path.join(source, "chunks", "big.bin"), Buffer.alloc(STATIC_ASSET_MAX_FILE_BYTES + 1));

    await expect(readNextStaticAssets(source)).rejects.toMatchObject({
      code: "artifact_policy_failed",
      issues: [expect.objectContaining({ field: "_next/static/chunks/big.bin", rule: "file_too_large" })],
    });
    expect(existsSync(path.join(site, "_next"))).toBe(false);
  });

  it("does not write through a destination junction", async () => {
    const source = path.join(tempDir(), "static", "chunks");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "app.js"), "console.log('copy');\n");
    const planned = await readNextStaticAssets(path.dirname(source));
    const { siteDir } = await createStagingDirectory(path.join(tempDir(), "dist", "staging"));
    const outside = path.join(tempDir(), "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(siteDir, "_next"), linkType);

    await expect(writeNextStaticAssets(siteDir, planned)).rejects.toMatchObject({
      code: "artifact_policy_failed",
      reason: "staging_path_escape",
    });
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe("next static assets in the producer", { timeout: 30_000 }, () => {
  it("copies the fixture tree into staging and leaves dist/site unchanged", async () => {
    const repo = makeTempRepo();
    temps.push(repo.repoRoot);
    const before = repo.siteSnapshot();
    const result = await runStaticProducer(fixtureProducerInput(repo, { nextStaticDir: checkedInStatic }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.staticAssets?.fileCount).toBe(3);
    expect(readFileSync(path.join(result.siteDir, "_next/static/chunks/app.js"), "utf8")).toBe(
      readFileSync(path.join(checkedInStatic, "chunks/app.js"), "utf8"),
    );
    expect(repo.siteSnapshot()).toEqual(before);
  });

  it("rejects a parent junction before creating staging or starting the child", async () => {
    const repo = makeTempRepo();
    temps.push(repo.repoRoot);
    const before = repo.siteSnapshot();
    const root = tempDir();
    const outside = path.join(root, "outside");
    mkdirSync(path.join(outside, "nested", "static"), { recursive: true });
    const secret = "SHOULD_NOT_READ_PARENT_JUNCTION";
    writeFileSync(path.join(outside, "nested", "static", "app.js"), secret);
    const link = path.join(root, "linked-parent");
    symlinkSync(outside, link, linkType);
    const marker = path.join(root, "spawned.txt");

    try {
      const result = await runStaticProducer(fixtureProducerInput(repo, {
        nextStaticDir: path.join(link, "nested", "static"),
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
        reason: "static_source_escape",
        stagingDir: null,
        childPid: null,
        issues: [expect.objectContaining({ field: "nextStaticDir", rule: "outside_source_realpath" })],
      });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(existsSync(marker)).toBe(false);
      expect(repo.siteSnapshot()).toEqual(before);
      expect(existsSync(path.join(repo.repoRoot, "dist", "staging"))).toBe(false);
    } finally {
      unlinkSync(link);
    }
  });

  it("refuses a forbidden static tree before creating staging or starting the child", async () => {
    const repo = makeTempRepo();
    temps.push(repo.repoRoot);
    const before = repo.siteSnapshot();
    const source = path.join(tempDir(), "static");
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "app.js.map"), "{}");
    const marker = path.join(tempDir(), "spawned.txt");
    const result = await runStaticProducer(fixtureProducerInput(repo, {
      nextStaticDir: source,
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
      issues: [expect.objectContaining({ rule: "forbidden_path" })],
    });
    expect(existsSync(marker)).toBe(false);
    expect(repo.siteSnapshot()).toEqual(before);
    expect(existsSync(path.join(repo.repoRoot, "dist", "staging"))).toBe(false);
  });

  it("keeps the previous crawl when the static directory is omitted", async () => {
    const repo = makeTempRepo();
    temps.push(repo.repoRoot);
    const result = await runStaticProducer(fixtureProducerInput(repo));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.staticAssets).toBeUndefined();
    expect(existsSync(path.join(result.siteDir, "_next"))).toBe(false);
  });
});

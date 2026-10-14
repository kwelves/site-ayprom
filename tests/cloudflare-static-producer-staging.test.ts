import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStagingDirectory, writeStagingFile } from "@/cloudflare/static-build/producer/staging";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "ayprom-staging-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("staging directory", () => {
  it("creates a unique staging tree with site and meta folders and never reuses it", async () => {
    const stagingRoot = path.join(root, "dist", "staging");
    const first = await createStagingDirectory(stagingRoot);
    const second = await createStagingDirectory(stagingRoot);
    expect(first.stagingDir).not.toBe(second.stagingDir);
    expect(path.dirname(first.stagingDir)).toBe(stagingRoot);
    expect(first.siteDir).toBe(path.join(first.stagingDir, "site"));
    expect(first.metaDir).toBe(path.join(first.stagingDir, "meta"));
    expect(readdirSync(stagingRoot)).toHaveLength(2);
    expect(readdirSync(first.stagingDir).sort()).toEqual(["meta", "site"]);
  });

  it("leaves an existing sibling dist/site alone", async () => {
    const site = path.join(root, "dist", "site");
    mkdirSync(site, { recursive: true });
    writeFileSync(path.join(site, "index.html"), "previous");
    await createStagingDirectory(path.join(root, "dist", "staging"));
    expect(readFileSync(path.join(site, "index.html"), "utf8")).toBe("previous");
  });
});

describe("staging file writes", () => {
  it("writes nested files and reports their size", async () => {
    const { siteDir } = await createStagingDirectory(path.join(root, "dist", "staging"));
    const written = await writeStagingFile(siteDir, "catalog/category/pto.html", Buffer.from("<html>"));
    expect(written).toEqual({ outputFile: "catalog/category/pto.html", bytes: 6 });
    expect(readFileSync(path.join(siteDir, "catalog", "category", "pto.html"), "utf8")).toBe("<html>");
  });

  it.each([
    "../escape.html",
    "catalog/../../escape.html",
    "/absolute.html",
    "C:/drive.html",
    "catalog\\windows.html",
    "catalog/NUL",
    "catalog/file.html:stream",
    "catalog//double.html",
    "",
  ])("rejects unsafe output path %s without writing", async (outputFile) => {
    const { siteDir } = await createStagingDirectory(path.join(root, "dist", "staging"));
    await expect(writeStagingFile(siteDir, outputFile, Buffer.from("x"))).rejects.toMatchObject({
      code: "artifact_policy_failed",
      reason: "staging_path_invalid",
    });
    expect(existsSync(path.join(root, "escape.html"))).toBe(false);
    expect(existsSync(path.join(root, "dist", "escape.html"))).toBe(false);
  });

  it("refuses to overwrite an existing file", async () => {
    const { siteDir } = await createStagingDirectory(path.join(root, "dist", "staging"));
    await writeStagingFile(siteDir, "index.html", Buffer.from("one"));
    await expect(writeStagingFile(siteDir, "index.html", Buffer.from("two"))).rejects.toMatchObject({
      code: "artifact_policy_failed",
      reason: "staging_duplicate_output",
    });
    expect(readFileSync(path.join(siteDir, "index.html"), "utf8")).toBe("one");
  });

  it("rejects a junction before creating nested directories outside the site", async () => {
    const { siteDir } = await createStagingDirectory(path.join(root, "dist", "staging"));
    const outside = path.join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(siteDir, "catalog"), process.platform === "win32" ? "junction" : "dir");

    await expect(
      writeStagingFile(siteDir, "catalog/created-before-validation/page.html", Buffer.from("x")),
    ).rejects.toMatchObject({
      code: "artifact_policy_failed",
      reason: "staging_path_escape",
    });
    expect(existsSync(path.join(outside, "created-before-validation"))).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses to write through a junction or symlink that leaves the site directory", async () => {
    const { siteDir } = await createStagingDirectory(path.join(root, "dist", "staging"));
    const outside = path.join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(siteDir, "catalog"), process.platform === "win32" ? "junction" : "dir");

    await expect(writeStagingFile(siteDir, "catalog/escape.html", Buffer.from("x"))).rejects.toMatchObject({
      code: "artifact_policy_failed",
      reason: "staging_path_escape",
    });
    expect(existsSync(path.join(outside, "escape.html"))).toBe(false);
  });

  it("refuses to write to a symlinked file target", async () => {
    const { siteDir } = await createStagingDirectory(path.join(root, "dist", "staging"));
    const outsideFile = path.join(root, "victim.html");
    writeFileSync(outsideFile, "victim");
    try {
      symlinkSync(outsideFile, path.join(siteDir, "index.html"), "file");
    } catch (error) {
      // Windows without developer mode may forbid file symlinks; nothing to test then.
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await expect(writeStagingFile(siteDir, "index.html", Buffer.from("x"))).rejects.toMatchObject({
      code: "artifact_policy_failed",
    });
    expect(readFileSync(outsideFile, "utf8")).toBe("victim");
  });
});

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { STATIC_ASSET_MAX_FILE_BYTES, validateArtifactPolicy, type ArtifactCandidate } from "../artifact-policy";
import { isPortablePathSegment } from "../portable-path";
import type { StaticBuildIssue } from "../validation";
import { ProducerError } from "./errors";
import { writeStagingFile } from "./staging";
import type { StaticAssetReport } from "./types";

// Copies one real `.next/static` directory to `site/_next/static`, preserving
// relative paths and bytes. Sibling directories such as `.next/server` and
// `.next/cache` are never visited because the caller passes the static
// directory itself. Symlinks and junctions, including those in any parent of
// the source directory, are refused before their target is read. A directory
// swapped for a junction between this check and the later
// write can still escape; that race is not closed.

const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".css", ".json", ".txt"]);

export interface PlannedStaticAsset {
  outputFile: string;
  bytes: Uint8Array;
  sha256: string;
}

interface FoundFile {
  relative: string;
  absolute: string;
  size: number;
}

export function staticOutputFile(relativePosix: string): string {
  if (!isSafeRelative(relativePosix)) {
    throw new ProducerError("artifact_policy_failed", "static_asset_rejected", {
      issues: [{ field: relativePosix, rule: "invalid_path" }],
    });
  }
  return `_next/static/${relativePosix}`;
}

export function staticAssetReport(assets: readonly PlannedStaticAsset[]): StaticAssetReport {
  const files = assets
    .map((asset) => ({ path: asset.outputFile, bytes: asset.bytes.byteLength, sha256: asset.sha256 }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
}

/** Reads and validates the tree. Writes nothing. */
export async function readNextStaticAssets(
  sourceDir: string,
  reservedOutputFiles: readonly string[] = [],
): Promise<PlannedStaticAsset[]> {
  const found = await listStaticFiles(sourceDir);
  const issues: StaticBuildIssue[] = [];
  const seen = new Map<string, string>();
  for (const reserved of reservedOutputFiles) {
    seen.set(reserved.toLowerCase(), reserved);
  }

  const readable: { outputFile: string; absolute: string }[] = [];
  for (const file of found) {
    if (!isSafeRelative(file.relative)) {
      issues.push({ field: file.relative, rule: "invalid_path" });
      continue;
    }
    const outputFile = `_next/static/${file.relative}`;
    const previous = seen.get(outputFile.toLowerCase());
    if (previous !== undefined) {
      issues.push({
        field: outputFile,
        rule: previous === outputFile ? "duplicate_path" : "case_insensitive_collision",
      });
      continue;
    }
    seen.set(outputFile.toLowerCase(), outputFile);
    if (file.size > STATIC_ASSET_MAX_FILE_BYTES) {
      issues.push({ field: outputFile, rule: "file_too_large" });
      continue;
    }
    readable.push({ outputFile, absolute: file.absolute });
  }

  const planned: PlannedStaticAsset[] = [];
  const candidates: ArtifactCandidate[] = [];
  for (const file of readable) {
    const bytes = new Uint8Array(await fs.readFile(file.absolute));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    planned.push({ outputFile: file.outputFile, bytes, sha256 });
    candidates.push({
      path: file.outputFile,
      size: bytes.byteLength,
      text: isTextAsset(file.outputFile) ? Buffer.from(bytes).toString("utf8") : undefined,
    });
  }
  const policy = validateArtifactPolicy(candidates);
  if (!policy.ok) issues.push(...policy.issues);
  if (issues.length > 0) {
    throw new ProducerError("artifact_policy_failed", "static_asset_rejected", { issues });
  }
  return planned.sort((left, right) => (left.outputFile < right.outputFile ? -1 : left.outputFile > right.outputFile ? 1 : 0));
}

export async function writeNextStaticAssets(
  siteDir: string,
  assets: readonly PlannedStaticAsset[],
): Promise<void> {
  for (const asset of assets) {
    await writeStagingFile(siteDir, asset.outputFile, asset.bytes);
  }
}

async function listStaticFiles(sourceDir: string): Promise<FoundFile[]> {
  // A junction above sourceDir is followed by realpath, so the later
  // "inside the real source" check would trust the escaped tree. Reject any
  // symlink or junction on the path before reading a file or listing it.
  await assertRealAncestors(sourceDir);

  let rootStat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    rootStat = await fs.lstat(sourceDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProducerError("artifact_policy_failed", "static_source_missing", {
        issues: [{ field: "nextStaticDir", rule: "missing" }],
      });
    }
    throw error;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new ProducerError("artifact_policy_failed", "static_source_escape", {
      issues: [{ field: "nextStaticDir", rule: "outside_source_realpath" }],
    });
  }
  const realSource = await fs.realpath(sourceDir);
  const found: FoundFile[] = [];
  await walk(sourceDir, realSource, "", found);
  return found;
}

async function walk(
  directory: string,
  realSource: string,
  relative: string,
  found: FoundFile[],
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
    const childRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
    const absolute = path.join(directory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new ProducerError("artifact_policy_failed", "static_source_escape", {
        issues: [{ field: `_next/static/${childRelative}`, rule: "outside_source_realpath" }],
      });
    }
    const realChild = await fs.realpath(absolute);
    if (!isInside(realSource, realChild)) {
      throw new ProducerError("artifact_policy_failed", "static_source_escape", {
        issues: [{ field: `_next/static/${childRelative}`, rule: "outside_source_realpath" }],
      });
    }
    if (stat.isDirectory()) {
      await walk(absolute, realSource, childRelative, found);
      continue;
    }
    if (!stat.isFile()) {
      throw new ProducerError("artifact_policy_failed", "static_asset_rejected", {
        issues: [{ field: `_next/static/${childRelative}`, rule: "invalid_path" }],
      });
    }
    found.push({ relative: childRelative, absolute, size: stat.size });
  }
}

async function assertRealAncestors(sourceDir: string): Promise<void> {
  const resolved = path.resolve(sourceDir);
  const filesystemRoot = path.parse(resolved).root;
  const ancestors: string[] = [];
  let cursor = path.dirname(resolved);
  while (cursor !== filesystemRoot) {
    ancestors.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (const ancestor of ancestors.reverse()) {
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(ancestor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ProducerError("artifact_policy_failed", "static_source_missing", {
          issues: [{ field: "nextStaticDir", rule: "missing" }],
        });
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new ProducerError("artifact_policy_failed", "static_source_escape", {
        issues: [{ field: "nextStaticDir", rule: "outside_source_realpath" }],
      });
    }
  }
}

function isSafeRelative(relativePosix: string): boolean {
  if (relativePosix === "" || relativePosix.startsWith("/") || relativePosix.includes("\\")) return false;
  return relativePosix.split("/").every(isPortablePathSegment);
}

function isTextAsset(outputFile: string): boolean {
  return TEXT_EXTENSIONS.has(path.posix.extname(outputFile).toLowerCase());
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

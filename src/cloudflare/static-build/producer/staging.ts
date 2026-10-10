import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isPortablePathSegment } from "../portable-path";
import { ProducerError } from "./errors";

export interface StagingDirectories {
  stagingDir: string;
  siteDir: string;
  metaDir: string;
}

// Read-only check. Call it before creating any staging directory.
//
// Lexical containment inside dist is not enough: on Windows a junction (and on
// POSIX a directory symlink) keeps the lexical path inside the repository while
// its real path is elsewhere. Every existing component from the repository root
// to the staging root is therefore lstat'd. A reparse point is refused. So is a
// real path outside the repository's own dist, and so is dist/site or anything
// that resolves into it, including a junction aimed at that tree.
//
// This does not close a time-of-check/time-of-use race where a directory is
// replaced by a junction after this function returns and before mkdir.
export async function assertStagingRootAllowed(repoRoot: string, stagingRoot: string): Promise<void> {
  const resolvedRepo = path.resolve(repoRoot);
  const resolvedStaging = path.resolve(stagingRoot);
  const distRoot = path.resolve(resolvedRepo, "dist");
  const siteRoot = path.resolve(distRoot, "site");

  if (!isInside(distRoot, resolvedStaging) || pathsEqual(resolvedStaging, distRoot)) {
    throw stagingRootError("outside_dist");
  }
  if (isLexicalSiteTree(distRoot, resolvedStaging)) {
    throw stagingRootError("site_tree_forbidden");
  }

  let realRepo: string;
  try {
    realRepo = await fs.realpath(resolvedRepo);
  } catch {
    throw stagingRootError("outside_dist_realpath");
  }

  const relative = path.relative(resolvedRepo, resolvedStaging);
  const segments = relative.split(path.sep).filter((segment) => segment !== "");
  let cursor = resolvedRepo;
  let realAllowed: string | null = null;

  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }

    const realCursor = await fs.realpath(cursor);
    if (stat.isSymbolicLink()) {
      throw stagingRootError(await resolvesToSite(siteRoot, realCursor)
        ? "site_tree_forbidden"
        : "outside_dist_realpath");
    }
    if (!stat.isDirectory()) {
      throw stagingRootError("outside_dist_realpath");
    }
    if (!(realAllowed === null ? isInside(realRepo, realCursor) : isInside(realAllowed, realCursor))) {
      throw stagingRootError("outside_dist_realpath");
    }
    if (await resolvesToSite(siteRoot, realCursor)) {
      throw stagingRootError("site_tree_forbidden");
    }
    realAllowed = realCursor;
  }

  if (realAllowed === null) {
    const firstMissing = segments[0] ?? "";
    const segment = process.platform === "win32" ? firstMissing.toLowerCase() : firstMissing;
    if (segment !== "dist") throw stagingRootError("outside_dist");
  }
}

// A fresh staging tree for every run: dist/staging/<timestamp>-<random>/{site,meta}.
// The directory is created non-recursively so an existing name (another
// run, a leftover from a failed run) is never reused or cleaned.
export async function createStagingDirectory(stagingRoot: string): Promise<StagingDirectories> {
  await fs.mkdir(stagingRoot, { recursive: true });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const stagingDir = path.join(stagingRoot, `${stamp}-${randomBytes(4).toString("hex")}`);
    try {
      await fs.mkdir(stagingDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    const siteDir = path.join(stagingDir, "site");
    const metaDir = path.join(stagingDir, "meta");
    await fs.mkdir(siteDir);
    await fs.mkdir(metaDir);
    return { stagingDir, siteDir, metaDir };
  }
  throw new ProducerError("artifact_policy_failed", "staging_directory_unavailable");
}

// Writes one output file below siteDir. Rejects anything that is not a plain
// portable relative path, anything whose real parent directory resolves
// outside siteDir (symlink/junction escape), and any pre-existing target.
export async function writeStagingFile(
  siteDir: string,
  outputFile: string,
  bytes: Uint8Array,
): Promise<{ outputFile: string; bytes: number }> {
  if (!isSafeOutputFile(outputFile)) {
    throw new ProducerError("artifact_policy_failed", "staging_path_invalid");
  }
  const resolved = path.resolve(siteDir, outputFile);
  const relative = path.relative(siteDir, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ProducerError("artifact_policy_failed", "staging_path_invalid");
  }

  // Create missing parents one level at a time, and only after the current
  // directory's real path is still inside siteDir. A junction is rejected
  // before any deeper mkdir, so a refused write does not leave an empty
  // directory outside the site tree. A directory replaced by a junction
  // between this check and mkdir can still escape; that race is not closed.
  const realSite = await fs.realpath(siteDir);
  const segments = outputFile.split("/");
  const fileName = segments.pop();
  if (!fileName) {
    throw new ProducerError("artifact_policy_failed", "staging_path_invalid");
  }
  let directory = siteDir;
  for (const segment of segments) {
    const next = path.join(directory, segment);
    const existing = await fs.lstat(next).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new ProducerError("artifact_policy_failed", "staging_path_escape");
      }
      const realNext = await fs.realpath(next);
      if (!isInside(realSite, realNext)) {
        throw new ProducerError("artifact_policy_failed", "staging_path_escape");
      }
      directory = next;
      continue;
    }
    const realDirectory = await fs.realpath(directory);
    if (!isInside(realSite, realDirectory)) {
      throw new ProducerError("artifact_policy_failed", "staging_path_escape");
    }
    try {
      await fs.mkdir(next);
    } catch (error) {
      // Another crawl worker can create the same parent between lstat and mkdir.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const created = await fs.lstat(next);
    if (created.isSymbolicLink() || !created.isDirectory()) {
      throw new ProducerError("artifact_policy_failed", "staging_path_escape");
    }
    const realCreated = await fs.realpath(next);
    if (!isInside(realSite, realCreated)) {
      throw new ProducerError("artifact_policy_failed", "staging_path_escape");
    }
    directory = next;
  }
  const realParent = await fs.realpath(directory);
  if (!isInside(realSite, realParent)) {
    throw new ProducerError("artifact_policy_failed", "staging_path_escape");
  }
  const target = path.join(directory, fileName);

  const existing = await fs.lstat(target).catch(() => null);
  if (existing) {
    throw new ProducerError(
      "artifact_policy_failed",
      existing.isSymbolicLink() ? "staging_path_escape" : "staging_duplicate_output",
    );
  }

  let handle: fs.FileHandle;
  try {
    // "wx" fails on any existing entry, including a symlink created after the lstat above.
    handle = await fs.open(target, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ProducerError("artifact_policy_failed", "staging_duplicate_output");
    }
    throw error;
  }
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  return { outputFile, bytes: bytes.byteLength };
}

export function isSafeOutputFile(outputFile: string): boolean {
  if (
    outputFile === "" ||
    outputFile.startsWith("/") ||
    /^[A-Za-z]:/.test(outputFile) ||
    outputFile.includes("\\")
  ) {
    return false;
  }
  return outputFile.split("/").every(isPortablePathSegment);
}

function stagingRootError(rule: string): ProducerError {
  return new ProducerError("artifact_policy_failed", "staging_root_forbidden", {
    issues: [{ field: "outputRoot", rule }],
  });
}

function isLexicalSiteTree(distRoot: string, candidate: string): boolean {
  const relative = path.relative(distRoot, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const first = relative.split(path.sep)[0] ?? "";
  const segment = process.platform === "win32" ? first.toLowerCase() : first;
  return segment === "site";
}

async function resolvesToSite(siteRoot: string, realPath: string): Promise<boolean> {
  try {
    return isInside(await fs.realpath(siteRoot), realPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function pathsEqual(left: string, right: string): boolean {
  return path.relative(left, right) === "";
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

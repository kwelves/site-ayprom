import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "parse5";
import { STATIC_ASSET_MAX_FILE_BYTES, validateArtifactPolicy, type ArtifactCandidate } from "../artifact-policy";
import { isPortablePathSegment } from "../portable-path";
import type { StaticBuildIssue } from "../validation";
import { ProducerError } from "./errors";
import type { PlannedStaticAsset } from "./static-assets";

// Copies git-tracked public/ files that are actually referenced by HTML, CSS,
// or metadata already written into staging. A broad copy of public/ is refused.
// Suspicious paths are rejected before any read of their target. A directory
// replaced by a junction after this check can still escape; that race is not closed.

const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt", ".xml"]);
const SCANNED_EXTENSIONS = new Set([".css", ".html", ".json", ".txt", ".xml"]);
const ATTRIBUTE = /\b(srcset|imagesrcset|src|href|poster|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
// <meta http-equiv="refresh" content="1;url=/admin/products"> is a navigation
// hint, not a file to copy out of public/.
const REFRESH_CONTENT = /^\d+(?:\.\d+)?\s*;\s*url\s*=/i;
const CONTENT_ADDRESS = /^(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|\/|\.{1,2}\/)\S*$/i;
const CSS_URL =/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;

export interface PublicAssetScan {
  siteDir: string;
  metaDir?: string;
  publicDir: string;
  repoRoot: string;
  siteOrigin: string;
  routePaths: readonly string[];
  reservedOutputFiles: readonly string[];
  /** Test seam. Production uses `git ls-files` for public/. */
  trackedPublicFiles?: readonly string[];
}

export function extractAssetReferences(input: {
  text: string;
  baseUrlPath: string;
  siteOrigin: string;
  routePaths: readonly string[];
}): { assets: string[]; issues: StaticBuildIssue[] } {
  const routes = new Set(input.routePaths);
  const assets: string[] = [];
  const issues: StaticBuildIssue[] = [];
  const seen = new Set<string>();
  for (const raw of findRawReferences(input.text)) {
    const classified = classifyReference(raw, input.baseUrlPath, input.siteOrigin, routes);
    if (classified.kind === "ignore") continue;
    if (classified.kind === "reject") {
      issues.push({ field: raw, rule: "invalid_path" });
      continue;
    }
    if (seen.has(classified.path)) continue;
    seen.add(classified.path);
    assets.push(classified.path);
  }
  return { assets, issues };
}

export async function listGitTrackedPublicFiles(repoRoot: string): Promise<string[]> {
  const result = spawnSync("git", ["-c", "core.quotepath=false", "ls-files", "-z", "--", "public"], {
    cwd: repoRoot,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new ProducerError("artifact_policy_failed", "git_public_list_failed", {
      issues: [{ field: "publicRepoRoot", rule: "git_ls_files_failed" }],
    });
  }
  const files: string[] = [];
  for (const entry of Buffer.from(result.stdout ?? "").toString("utf8").split("\0")) {
    if (entry === "") continue;
    const normalized = entry.replaceAll("\\", "/");
    if (!normalized.startsWith("public/")) continue;
    const relative = normalized.slice("public/".length);
    if (!isSafeRelative(relative)) {
      throw new ProducerError("artifact_policy_failed", "static_asset_rejected", {
        issues: [{ field: relative, rule: "invalid_path" }],
      });
    }
    files.push(relative);
  }
  return files;
}

export async function readReferencedPublicAssets(input: PublicAssetScan): Promise<PlannedStaticAsset[]> {
  const documents = await collectDocuments(input.siteDir, input.metaDir);
  const routes = new Set(input.routePaths);
  const issues: StaticBuildIssue[] = [];
  const queue = documents.flatMap((document) => {
    const extracted = extractAssetReferences({
      text: document.text,
      baseUrlPath: outputFileToUrlPath(document.outputFile),
      siteOrigin: input.siteOrigin,
      routePaths: input.routePaths,
    });
    issues.push(...extracted.issues);
    return extracted.assets;
  });
  if (issues.length > 0) {
    throw new ProducerError("artifact_policy_failed", "public_asset_rejected", { issues });
  }

  const trackedList = input.trackedPublicFiles ?? await listGitTrackedPublicFiles(input.repoRoot);
  const tracked = new Map<string, string>();
  for (const file of trackedList) tracked.set(file.toLowerCase(), file);
  // Lazily loaded UI names its photos only inside scripts and hydration data, never in HTML attributes.
  // Every such literal path is queued: a tracked file is copied, anything else fails the build (no 404 later).
  queue.push(...findLiteralPublicMentions(
    [...documents.map((document) => document.text), ...await readScriptTexts(input.siteDir)], trackedList));
  const reserved = new Map(input.reservedOutputFiles.map((file) => [file.toLowerCase(), file]));
  const planned: PlannedStaticAsset[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const asset = queue.shift();
    if (asset === undefined || seen.has(asset.toLowerCase())) continue;
    seen.add(asset.toLowerCase());

    const reservedMatch = reserved.get(asset.toLowerCase());
    if (reservedMatch !== undefined) {
      issues.push({
        field: asset,
        rule: reservedMatch === asset ? "duplicate_path" : "case_insensitive_collision",
      });
      continue;
    }
    const trackedMatch = tracked.get(asset.toLowerCase());
    if (trackedMatch === undefined) {
      issues.push({ field: asset, rule: await missingOrUntracked(input.publicDir, asset) });
      continue;
    }
    if (trackedMatch !== asset) {
      issues.push({ field: asset, rule: "case_insensitive_collision" });
      continue;
    }

    const absolute = resolveInside(input.publicDir, asset);
    if (absolute === null) {
      issues.push({ field: asset, rule: "invalid_path" });
      continue;
    }
    const stat = await assertRealPublicFile(input.publicDir, absolute);
    if (stat.kind === "reject") {
      issues.push({ field: asset, rule: stat.rule });
      continue;
    }
    if (stat.size > STATIC_ASSET_MAX_FILE_BYTES) {
      issues.push({ field: asset, rule: "file_too_large" });
      continue;
    }
    const bytes = new Uint8Array(await fs.readFile(absolute));
    planned.push({
      outputFile: asset,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (asset.endsWith(".css")) {
      const extracted = extractAssetReferences({
        text: Buffer.from(bytes).toString("utf8"),
        baseUrlPath: `/${asset}`,
        siteOrigin: input.siteOrigin,
        routePaths: [...routes],
      });
      issues.push(...extracted.issues);
      queue.push(...extracted.assets);
    }
  }

  if (issues.length > 0) {
    throw new ProducerError("artifact_policy_failed", "public_asset_rejected", { issues });
  }
  const candidates: ArtifactCandidate[] = planned.map((asset) => ({
    path: asset.outputFile,
    size: asset.bytes.byteLength,
    text: TEXT_EXTENSIONS.has(path.posix.extname(asset.outputFile).toLowerCase())
      ? Buffer.from(asset.bytes).toString("utf8")
      : undefined,
  }));
  const policy = validateArtifactPolicy(candidates);
  if (!policy.ok) {
    throw new ProducerError(policy.code, "public_asset_rejected", { issues: policy.issues });
  }
  return planned.sort((left, right) => (left.outputFile < right.outputFile ? -1 : left.outputFile > right.outputFile ? 1 : 0));
}

function findRawReferences(text: string): string[] {
  const searchable = withoutExecutableScriptBodies(text);
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    if (value === "" || seen.has(value)) return;
    seen.add(value);
    found.push(value);
  };
  for (const match of searchable.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase() ?? "";
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name === "srcset" || name === "imagesrcset") {
      for (const part of value.split(",")) {
        const url = part.trim().split(/\s+/)[0];
        if (url) add(url);
      }
    } else if (name === "content") {
      // Meta content is mostly descriptive text ("100л/мин"), not a file. Only an address-shaped
      // value (no whitespace; absolute, protocol-relative, root- or dot-relative) is a reference.
      if (CONTENT_ADDRESS.test(value) && !REFRESH_CONTENT.test(value.trim())) add(value);
    } else if (value) {
      add(value);
    }
  }
  for (const match of searchable.matchAll(CSS_URL)) {
    add(match[1] ?? match[2] ?? match[3] ?? "");
  }
  // Metadata JSON keeps URLs in quoted strings. Srcset descriptors contain
  // spaces and are already split above, so they are not parsed again.
  // Consume whole JSON strings, including escaped quotes. A URL inside a
  // serialized Next hydration string is not a standalone quoted URL token.
  for (const match of searchable.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    let value: string;
    try { value = JSON.parse(match[0]) as string; } catch { continue; }
    if (!/^(?:https?:\/\/|\/)/.test(value)) continue;
    if (value.includes(" ") || value.includes(",")) continue;
    add(value);
  }
  return found;
}

function withoutExecutableScriptBodies(text: string): string {
  if (!/<script(?:\s|>)/i.test(text)) return text;

  type ScanNode = {
    tagName?: string;
    attrs?: { name: string; value: string }[];
    childNodes?: ScanNode[];
    sourceCodeLocation?: {
      startTag?: { endOffset: number };
      endTag?: { startOffset: number };
    } | null;
  };
  const ranges: [number, number][] = [];
  function visit(node: ScanNode): void {
    if (node.tagName === "script" &&
        node.attrs?.find((attr) => attr.name === "type")?.value.toLowerCase() !== "application/ld+json") {
      const start = node.sourceCodeLocation?.startTag?.endOffset;
      const end = node.sourceCodeLocation?.endTag?.startOffset;
      if (start !== undefined && end !== undefined && end >= start) ranges.push([start, end]);
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(text, { sourceCodeLocationInfo: true }) as ScanNode);
  for (const [start, end] of ranges.sort((left, right) => right[0] - left[0])) {
    text = `${text.slice(0, start)}${" ".repeat(end - start)}${text.slice(end)}`;
  }
  return text;
}

function classifyReference(
  raw: string,
  baseUrlPath: string,
  siteOrigin: string,
  routes: ReadonlySet<string>,
): { kind: "ignore" } | { kind: "reject" } | { kind: "asset"; path: string } {
  const trimmed = raw.trim();
  if (
    trimmed === "" ||
    trimmed.startsWith("#") ||
    /^(?:data|mailto|tel|javascript|blob):/i.test(trimmed) ||
    !looksLikeReference(trimmed)
  ) {
    return { kind: "ignore" };
  }
  const bare = (trimmed.split("#")[0] ?? "").split("?")[0] ?? "";
  if (bare === "") return { kind: "ignore" };
  const pathname = pathnameOf(bare, baseUrlPath, siteOrigin);
  if (pathname === null) return { kind: "ignore" };
  if (pathname.kind === "reject") return { kind: "reject" };
  if (pathname.value === "/" || routes.has(pathname.value) || isIgnoredPrefix(pathname.value)) {
    return { kind: "ignore" };
  }
  const asset = toAssetPath(pathname.value);
  if (asset === null) return { kind: "reject" };
  if (routes.has(`/${asset}`) || isIgnoredPrefix(`/${asset}`)) return { kind: "ignore" };
  return { kind: "asset", path: asset };
}

function looksLikeReference(value: string): boolean {
  return value.startsWith("/") || value.startsWith(".") || value.startsWith("//")
    || value.includes("/") || /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function pathnameOf(
  bare: string,
  baseUrlPath: string,
  siteOrigin: string,
): { kind: "path"; value: string } | { kind: "reject" } | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith("//")) {
    let parsed: URL;
    try {
      parsed = new URL(bare, siteOrigin);
    } catch {
      return { kind: "reject" };
    }
    if (parsed.origin !== new URL(siteOrigin).origin) return null;
    const origin = parsed.origin;
    const afterOrigin = bare.startsWith("//")
      ? bare.slice(bare.indexOf("/", 2))
      : bare.slice(origin.length);
    return { kind: "path", value: afterOrigin.startsWith("/") ? afterOrigin : `/${afterOrigin}` };
  }
  if (bare.startsWith("/")) return { kind: "path", value: bare };
  if (!bare.startsWith(".") && bare.includes(":") ) return null;
  const baseSegments = baseUrlPath.split("/").filter((segment) => segment !== "");
  if (baseUrlPath !== "/" && !baseUrlPath.endsWith("/")) baseSegments.pop();
  return { kind: "path", value: `/${[...baseSegments, ...bare.split("/")].join("/")}` };
}

function toAssetPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("%") || decoded.includes("\\") || decoded.includes("\0")) return null;
  const segments = decoded.split("/");
  if (segments[0] !== "") return null;
  const stack: string[] = [];
  for (const segment of segments.slice(1)) {
    if (segment === "" || segment === "." || /[\s,]/.test(segment)) return null;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    if (!isPortablePathSegment(segment)) return null;
    stack.push(segment);
  }
  return stack.join("/");
}

function isIgnoredPrefix(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname === "/_next" || pathname.startsWith("/_next/");
}

function isSafeRelative(relativePosix: string): boolean {
  return toAssetPath(`/${relativePosix}`) === relativePosix;
}

function outputFileToUrlPath(outputFile: string): string {
  if (outputFile === "index.html") return "/";
  if (outputFile === "404.html") return "/404";
  if (outputFile.endsWith(".html")) return `/${outputFile.slice(0, -".html".length)}`;
  return `/${outputFile}`;
}

async function collectDocuments(
  siteDir: string,
  metaDir: string | undefined,
): Promise<{ outputFile: string; text: string }[]> {
  const documents: { outputFile: string; text: string }[] = [];
  await walkDocuments(siteDir, siteDir, documents);
  if (metaDir) await walkDocuments(metaDir, metaDir, documents);
  return documents;
}

async function walkDocuments(
  directory: string,
  root: string,
  documents: { outputFile: string; text: string }[],
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new ProducerError("artifact_policy_failed", "static_source_escape", {
        issues: [{ field: "site", rule: "outside_source_realpath" }],
      });
    }
    if (stat.isDirectory()) {
      await walkDocuments(absolute, root, documents);
      continue;
    }
    if (!stat.isFile() || !SCANNED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    documents.push({
      outputFile: path.relative(root, absolute).replaceAll("\\", "/"),
      text: await fs.readFile(absolute, "utf8"),
    });
  }
}

const ASSET_EXTENSIONS = "webp|png|jpe?g|svg|avif|gif|ico|woff2?|ttf|otf|mp4|webm";
// A path is a literal mention only when it is not the tail of a longer path or URL (no path/domain character
// before the slash) and not the prefix of a longer name (".webp.map", ".webpx").
const BEFORE = String.raw`(?<![A-Za-z0-9_.%:/-])`;
const AFTER = String.raw`(?![A-Za-z0-9_%-]|\.[A-Za-z0-9])`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Paths (relative to public/) named literally in built text: every tracked file, plus any path that points
 * into a known public folder with an asset extension (so a missing file is reported, not silently shipped). */
function findLiteralPublicMentions(texts: readonly string[], trackedList: readonly string[]): string[] {
  if (trackedList.length === 0) return [];
  const dirs = [...new Set(trackedList.filter((file) => file.includes("/")).map((file) => file.split("/")[0]))]
    .sort().map(escapeRegExp);
  const names = [...trackedList].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const patterns = [new RegExp(`${BEFORE}/(${names.join("|")})${AFTER}`, "g")];
  if (dirs.length > 0) {
    patterns.push(new RegExp(
      `${BEFORE}/((?:${dirs.join("|")})/[A-Za-z0-9_.%-]+(?:/[A-Za-z0-9_.%-]+)*\\.(?:${ASSET_EXTENSIONS}))${AFTER}`, "g"));
  }
  const found = new Set<string>();
  for (const text of texts) {
    if (!text.includes("/")) continue;
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        let relative = match[1];
        try { relative = decodeURIComponent(relative); } catch { /* keep the raw spelling; the policy rejects it */ }
        found.add(relative);
      }
    }
  }
  return [...found];
}

async function readScriptTexts(siteDir: string): Promise<string[]> {
  const texts: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await walk(absolute); continue; }
      if (!/\.m?js$/i.test(entry.name)) continue;
      const stat = await fs.stat(absolute);
      if (stat.size <= 8 * 1024 * 1024) texts.push(await fs.readFile(absolute, "utf8"));
    }
  };
  await walk(path.join(siteDir, "_next", "static"));
  return texts;
}

async function missingOrUntracked(publicDir: string, asset: string): Promise<string> {
  const absolute = resolveInside(publicDir, asset);
  if (absolute === null) return "invalid_path";
  try {
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) return "outside_source_realpath";
    return "untracked_public_asset";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing_public_asset";
    throw error;
  }
}

async function assertRealPublicFile(
  publicDir: string,
  filePath: string,
): Promise<{ kind: "file"; size: number } | { kind: "reject"; rule: string }> {
  const resolvedPublic = path.resolve(publicDir);
  const chain: string[] = [];
  let cursor = filePath;
  while (true) {
    chain.push(cursor);
    if (path.relative(resolvedPublic, cursor) === "") break;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  let size = 0;
  for (const component of chain.reverse()) {
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(component);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "reject", rule: "missing_public_asset" };
      throw error;
    }
    if (stat.isSymbolicLink()) return { kind: "reject", rule: "outside_source_realpath" };
    size = stat.size;
  }
  if (!chain.length) return { kind: "reject", rule: "invalid_path" };
  const fileStat = await fs.lstat(filePath);
  if (!fileStat.isFile()) return { kind: "reject", rule: "invalid_path" };
  return { kind: "file", size: fileStat.size || size };
}

function resolveInside(publicDir: string, relativePosix: string): string | null {
  if (!isSafeRelative(relativePosix)) return null;
  const target = path.resolve(publicDir, ...relativePosix.split("/"));
  const relative = path.relative(path.resolve(publicDir), target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

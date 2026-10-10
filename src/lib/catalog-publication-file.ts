// Node-only handoff from the private capture process to the Next build child.
// This file contains public catalog documents but never a release capability.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CatalogPublicationExport } from "@/cloudflare/static-build/producer/catalog-publication-export";
import { assertStagingRootAllowed, createStagingDirectory } from "@/cloudflare/static-build/producer/staging";
import { CATALOG_DOCUMENT_KINDS, catalogDocumentKey } from "@/lib/catalog-publication-reader";

const FILE_NAME = "catalog-publication-export.json";
const MAX_FILE_BYTES = 600 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 1_048_576;
const MAX_TOTAL_BYTES = 536_870_912;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

export class CatalogPublicationFileError extends Error {
  constructor() {
    super("Catalog publication file unavailable");
    this.name = "CatalogPublicationFileError";
  }
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function validateExport(value: unknown): CatalogPublicationExport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CatalogPublicationFileError();
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).sort().join(",") !== "documentCount,documents,format,releaseId,revision,sha256"
    || entry.format !== 1 || typeof entry.releaseId !== "string" || !UUID.test(entry.releaseId)
    || !Number.isSafeInteger(entry.revision) || (entry.revision as number) < 0
    || typeof entry.sha256 !== "string" || !HASH.test(entry.sha256)
    || !Number.isSafeInteger(entry.documentCount) || (entry.documentCount as number) < 0
    || (entry.documentCount as number) > 20_000
    || !entry.documents || typeof entry.documents !== "object" || Array.isArray(entry.documents)) {
    throw new CatalogPublicationFileError();
  }
  const documents = entry.documents as Record<string, unknown>;
  if (Object.keys(documents).sort().join(",") !== [...CATALOG_DOCUMENT_KINDS].sort().join(",")) {
    throw new CatalogPublicationFileError();
  }
  let count = 0;
  let bytes = 0;
  for (const kind of CATALOG_DOCUMENT_KINDS) {
    const rows = documents[kind];
    if (!Array.isArray(rows)) throw new CatalogPublicationFileError();
    const keys = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new CatalogPublicationFileError();
      const key = catalogDocumentKey(kind, row as Record<string, unknown>);
      if (!key || key.length > 256 || keys.has(key)) throw new CatalogPublicationFileError();
      keys.add(key);
      const size = Buffer.byteLength(JSON.stringify(row));
      if (size > MAX_DOCUMENT_BYTES) throw new CatalogPublicationFileError();
      bytes += size;
      count += 1;
      if (bytes > MAX_TOTAL_BYTES || count > 20_000) throw new CatalogPublicationFileError();
    }
  }
  if (count !== entry.documentCount) throw new CatalogPublicationFileError();
  return value as CatalogPublicationExport;
}

/** Creates a new ignored staging tree; never overwrites or promotes dist/site. */
export async function writeCatalogPublicationFile(input: {
  repoRoot: string;
  publication: CatalogPublicationExport;
}): Promise<{ path: string; sha256: string; releaseId: string }> {
  try {
    const publication = validateExport(input.publication);
    const bytes = Buffer.from(`${JSON.stringify(publication)}\n`, "utf8");
    if (bytes.byteLength > MAX_FILE_BYTES) throw new CatalogPublicationFileError();
    const stagingRoot = path.join(path.resolve(input.repoRoot), "dist", "staging");
    await assertStagingRootAllowed(input.repoRoot, stagingRoot);
    const staging = await createStagingDirectory(stagingRoot);
    await assertStagingRootAllowed(input.repoRoot, staging.metaDir);
    const target = path.join(staging.metaDir, FILE_NAME);
    await fs.writeFile(target, bytes, { flag: "wx" });
    return { path: target, sha256: createHash("sha256").update(bytes).digest("hex"),
      releaseId: publication.releaseId };
  } catch { throw new CatalogPublicationFileError(); }
}

/** Digest and path are supplied by the parent, not read from the file itself. */
export async function loadCatalogPublicationFile(input: {
  repoRoot: string;
  path: string;
  sha256: string;
  releaseId: string;
}): Promise<CatalogPublicationExport> {
  try {
    if (!HASH.test(input.sha256) || !UUID.test(input.releaseId) || !path.isAbsolute(input.path)) {
      throw new CatalogPublicationFileError();
    }
    const repoRoot = path.resolve(input.repoRoot);
    const stagingRoot = path.join(repoRoot, "dist", "staging");
    const relative = path.relative(stagingRoot, path.resolve(input.path));
    const segments = relative.split(path.sep);
    if (segments.length !== 3 || segments[1] !== "meta" || segments[2] !== FILE_NAME
      || !/^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/.test(segments[0] ?? "")
      || !samePath(path.resolve(stagingRoot, relative), input.path)) throw new CatalogPublicationFileError();
    await assertStagingRootAllowed(repoRoot, path.dirname(input.path));
    const stat = await fs.lstat(input.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_FILE_BYTES) {
      throw new CatalogPublicationFileError();
    }
    const bytes = await fs.readFile(input.path);
    if (createHash("sha256").update(bytes).digest("hex") !== input.sha256) throw new CatalogPublicationFileError();
    const value = validateExport(JSON.parse(bytes.toString("utf8")) as unknown);
    if (value.releaseId !== input.releaseId) throw new CatalogPublicationFileError();
    return value;
  } catch { throw new CatalogPublicationFileError(); }
}

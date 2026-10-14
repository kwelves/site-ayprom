import { promises as fs } from "node:fs";
import path from "node:path";
import type { RouteManifestEntry } from "../route-manifest";
import type { StaticBuildIssue } from "../validation";

// Checks crawled HTML documents against the route manifest. robots.txt and
// sitemap.xml are not documents. Product aliases stay pending: this report
// does not claim their redirects work.

export interface VerificationFailure {
  path: string;
  outputFile: string;
  rule: string;
}

export interface VerificationReport {
  schemaVersion: 1;
  ok: boolean;
  documents: { path: string; outputFile: string; ok: boolean }[];
  failures: VerificationFailure[];
  pendingAliases: { path: string; redirectTo: string; status: 308; runtime: "pending" }[];
}

type DocumentEntry = Extract<RouteManifestEntry, { class: "static" | "query" }>;

const SKIPPED_FAMILIES = new Set<RouteManifestEntry["family"]>(["robots", "sitemap"]);
const FORBIDDEN_URL = /localhost|127\.0\.0\.1|\[::1\]|vercel\.app|\/_next\/image/i;

export async function verifyStagedDocuments(
  siteDir: string,
  entries: readonly RouteManifestEntry[],
): Promise<VerificationReport> {
  const documents = entries
    .filter((entry): entry is DocumentEntry =>
      (entry.class === "static" || entry.class === "query") && !SKIPPED_FAMILIES.has(entry.family))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const failures: VerificationFailure[] = [];
  const checked: VerificationReport["documents"] = [];

  for (const entry of documents) {
    let html = "";
    try {
      html = await fs.readFile(path.join(siteDir, entry.outputFile), "utf8");
    } catch {
      failures.push({ path: entry.path, outputFile: entry.outputFile, rule: "document_missing" });
      checked.push({ path: entry.path, outputFile: entry.outputFile, ok: false });
      continue;
    }
    const entryFailures = verifyDocument(html, entry);
    failures.push(...entryFailures);
    checked.push({ path: entry.path, outputFile: entry.outputFile, ok: entryFailures.length === 0 });
  }

  const pendingAliases = entries
    .flatMap((entry) => entry.class === "redirect"
      ? [{ path: entry.path, redirectTo: entry.redirectTo, status: entry.status, runtime: "pending" as const }]
      : [])
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  return {
    schemaVersion: 1,
    ok: failures.length === 0,
    documents: checked,
    failures: failures.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : left.rule < right.rule ? -1 : left.rule > right.rule ? 1 : 0),
    pendingAliases,
  };
}

export function serializeVerificationReport(report: VerificationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function verificationIssues(report: VerificationReport): StaticBuildIssue[] {
  return report.failures.map((failure) => ({ field: failure.path, rule: failure.rule }));
}

function verifyDocument(html: string, entry: DocumentEntry): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  const fail = (rule: string) => failures.push({ path: entry.path, outputFile: entry.outputFile, rule });

  const canonicals = canonicalHrefs(html);
  if (entry.expectedCanonical === null) {
    if (canonicals.length > 0) fail("canonical_unexpected");
  } else if (canonicals.length === 0) {
    fail("canonical_missing");
  } else if (canonicals.length > 1) {
    fail("canonical_duplicate");
  } else if (canonicals[0] !== entry.expectedCanonical) {
    fail("canonical_mismatch");
  }

  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  if (titles.length !== 1 || textContent(titles[0]?.[1] ?? "") === "") fail("title_missing");
  const headings = [...withoutHidden(html).matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (headings.length !== 1 || textContent(headings[0]?.[1] ?? "") === "") fail("h1_count");

  const actualTypes = jsonLdTypes(html).sort();
  const expectedTypes = [...entry.expectedJsonLdTypes].sort();
  if (actualTypes.length !== expectedTypes.length || actualTypes.some((type, index) => type !== expectedTypes[index])) {
    fail("json_ld_mismatch");
  }

  const noindex = hasNoindex(html);
  if (entry.expectedIndexable && noindex) fail("indexability_mismatch");
  if (!entry.expectedIndexable && !noindex) fail("noindex_missing");
  if (FORBIDDEN_URL.test(html)) fail("forbidden_url");
  return failures;
}

function canonicalHrefs(html: string): string[] {
  const hrefs: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']canonical["']/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (href?.[1] !== undefined) hrefs.push(href[1]);
  }
  return hrefs;
}

function jsonLdTypes(html: string): string[] {
  const types: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectTypes(JSON.parse(match[1] ?? ""), types);
    } catch {
      types.push("__invalid__");
    }
  }
  return types;
}

function collectTypes(value: unknown, types: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTypes(item, types);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as { "@type"?: unknown; "@graph"?: unknown };
  if (typeof record["@type"] === "string") types.push(record["@type"]);
  else if (Array.isArray(record["@type"])) {
    for (const type of record["@type"]) if (typeof type === "string") types.push(type);
  }
  if (record["@graph"]) collectTypes(record["@graph"], types);
}

function hasNoindex(html: string): boolean {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bname\s*=\s*["'](?:robots|googlebot)["']/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    if (content.split(/[,\s]+/).some((token) => token.toLowerCase() === "noindex")) return true;
  }
  return false;
}

function withoutHidden(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "");
}

function textContent(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim();
}

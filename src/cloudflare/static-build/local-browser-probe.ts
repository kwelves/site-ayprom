import path from "node:path";
import { isPortablePathSegment } from "./portable-path";

export function isCatalogProductHref(href: string): boolean {
  return /^\/catalog\/category\/[a-z0-9-]+\/(?:[a-z0-9-]+|(?:subcategory|brand)\/[a-z0-9-]+\/[a-z0-9-]+)$/.test(href);
}

export function scopedPaginationProbePaths(entries: ReadonlyArray<{ path: string; family: string; class: string }>): string[] {
  return entries.filter((entry) => entry.class === "query" && (
    (entry.family === "category" && /^\/catalog\/category\/[a-z0-9-]+$/.test(entry.path))
    || (entry.family === "vehicle-type" && /^\/catalog\/vehicle-type\/[a-z0-9-]+$/.test(entry.path))
    || (entry.family === "category-brand" && /^\/catalog\/category\/[a-z0-9-]+\/brand\/[a-z0-9-]+$/.test(entry.path))
    || (entry.family === "subcategory" && /^\/catalog\/category\/[a-z0-9-]+\/subcategory\/[a-z0-9-]+$/.test(entry.path))
    || (entry.family === "brand-category-subcategory" && /^\/catalog\/brand\/[a-z0-9-]+\/category\/[a-z0-9-]+\/subcategory\/[a-z0-9-]+$/.test(entry.path))
  )).map((entry) => entry.path);
}

export function scopedPaginationProbeFilters(routePath: string): Record<string, string> {
  let match = /^\/catalog\/category\/([a-z0-9-]+)$/.exec(routePath);
  if (match) return { category: match[1] };
  match = /^\/catalog\/vehicle-type\/([a-z0-9-]+)$/.exec(routePath);
  if (match) return { vehicleType: match[1] };
  match = /^\/catalog\/category\/([a-z0-9-]+)\/brand\/([a-z0-9-]+)$/.exec(routePath);
  if (match) return { category: match[1], brand: match[2] };
  match = /^\/catalog\/category\/([a-z0-9-]+)\/subcategory\/([a-z0-9-]+)$/.exec(routePath);
  if (match) return { category: match[1], subcategory: match[2] };
  match = /^\/catalog\/brand\/([a-z0-9-]+)\/category\/([a-z0-9-]+)\/subcategory\/([a-z0-9-]+)$/.exec(routePath);
  if (match) return { category: match[2], subcategory: match[3], brand: match[1] };
  throw new Error("local_probe_invalid_path");
}

export function selectScopedProbePaths(available: string[], requested: string | null): string[] {
  if (requested === null) return available;
  const paths = requested.split(",");
  if (paths.length === 0 || paths.some((routePath) => !available.includes(routePath)) || new Set(paths).size !== paths.length) {
    throw new Error("local_probe_invalid_path");
  }
  return paths;
}

export async function waitForLocalProbe<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("local_probe_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Diagnostic-only inputs: not a release configuration or snapshot exporter.
export function localProbeBindings(url: string, key: string) {
  if (!["http://127.0.0.1:54321", "http://localhost:54321", "http://127.0.0.1:56421"].includes(url)) {
    throw new Error("local_probe_invalid_binding");
  }
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey && key.split(".").length === 3) {
    try {
      publicKey = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).role === "anon";
    } catch { publicKey = false; }
  }
  if (!publicKey) throw new Error("local_probe_invalid_binding");
  return { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key };
}

export function probeDocumentFile(urlPath: string): string {
  if (urlPath === "/") return "index.html";
  const segments = urlPath.slice(1).split("/");
  if (!urlPath.startsWith("/") || segments.some((s) => !/^[a-z0-9-]+$/.test(s) || !isPortablePathSegment(s))) {
    throw new Error("local_probe_invalid_path");
  }
  return `${segments.join("/")}/index.html`;
}

export function resolveExistingProbeSite(repoRoot: string, candidate: string) {
  if (!path.isAbsolute(candidate)) throw new Error("local_probe_invalid_site_dir");
  const stagingRoot = path.resolve(repoRoot, "dist", "staging");
  const siteDir = path.resolve(candidate);
  const segments = path.relative(stagingRoot, siteDir).split(path.sep);
  if (segments.length !== 2 || segments[1] !== "site" || !/^[A-Za-z0-9-]+$/.test(segments[0])
    || !isPortablePathSegment(segments[0])) throw new Error("local_probe_invalid_site_dir");
  const stagingDir = path.dirname(siteDir);
  return { stagingDir, siteDir, metaDir: path.join(stagingDir, "meta") };
}

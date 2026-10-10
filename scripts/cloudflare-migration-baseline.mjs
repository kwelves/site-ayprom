import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ORIGIN = "https://www.ayprom-gidravlika.kg";
const DEFAULT_CONCURRENCY = 4;
const MAX_REDIRECTS = 8;

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function cleanText(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function parseAttributes(tag) {
  const attributes = new Map();
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes.set(match[1].toLowerCase(), decodeEntities(match[2] ?? match[3] ?? ""));
  }
  return attributes;
}

function findMeta(html, selectorName, selectorValue) {
  const normalizedValue = selectorValue.toLowerCase();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if (attributes.get(selectorName)?.toLowerCase() === normalizedValue) {
      return attributes.get("content") ?? null;
    }
  }
  return null;
}

function findCanonical(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) return attributes.get("href") ?? null;
  }
  return null;
}

function collectJsonLdTypes(value, result) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdTypes(item, result);
    return;
  }
  if (!value || typeof value !== "object") return;

  const type = value["@type"];
  if (typeof type === "string") result.add(type);
  if (Array.isArray(type)) {
    for (const item of type) if (typeof item === "string") result.add(item);
  }
  for (const nested of Object.values(value)) collectJsonLdTypes(nested, result);
}

export function parseSitemapUrls(xml) {
  const urls = [];
  const seen = new Set();
  for (const match of xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const url = cleanText(match[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function extractHtmlSignals(html) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const headings = (level) => [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi"))]
    .map((match) => cleanText(match[1]))
    .filter(Boolean);
  const internalLinks = [];
  const seenLinks = new Set();
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = parseAttributes(match[0]).get("href");
    if (!href?.startsWith("/") || href.startsWith("//") || seenLinks.has(href)) continue;
    seenLinks.add(href);
    internalLinks.push(href);
  }

  const jsonLdTypes = new Set();
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectJsonLdTypes(JSON.parse(match[1]), jsonLdTypes);
    } catch {
      jsonLdTypes.add("__INVALID_JSON_LD__");
    }
  }

  return {
    title: titleMatch ? cleanText(titleMatch[1]) : null,
    description: findMeta(html, "name", "description"),
    robots: findMeta(html, "name", "robots"),
    canonical: findCanonical(html),
    ogTitle: findMeta(html, "property", "og:title"),
    ogDescription: findMeta(html, "property", "og:description"),
    ogImage: findMeta(html, "property", "og:image"),
    h1: headings(1),
    h2: headings(2),
    internalLinks,
    jsonLdTypes: [...jsonLdTypes].sort(),
    htmlBytes: Buffer.byteLength(html),
    htmlSha256: createHash("sha256").update(html).digest("hex"),
  };
}

export async function runWithConcurrency(items, concurrency, worker) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer");
  }
  const results = new Array(items.length);
  let cursor = 0;

  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

async function fetchGet(fetchImpl, url, redirect = "follow") {
  return fetchImpl(url, {
    method: "GET",
    redirect,
    headers: { "user-agent": "AYPROM-Cloudflare-Migration-Baseline/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
}

async function fetchRedirectChain(fetchImpl, requestedUrl) {
  const urls = [];
  const statuses = [];
  let currentUrl = requestedUrl;

  for (let step = 0; step <= MAX_REDIRECTS; step += 1) {
    urls.push(currentUrl);
    const response = await fetchGet(fetchImpl, currentUrl, "manual");
    statuses.push(response.status);
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return { requestedUrl, finalUrl: currentUrl, urls, statuses };
    }
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error(`Too many redirects for ${requestedUrl}`);
}

async function inspectPage(fetchImpl, requestedUrl) {
  try {
    const response = await fetchGet(fetchImpl, requestedUrl);
    const html = await response.text();
    return {
      requestedUrl,
      finalUrl: response.url || requestedUrl,
      status: response.status,
      contentType: response.headers.get("content-type"),
      ...extractHtmlSignals(html),
    };
  } catch (error) {
    return {
      requestedUrl,
      finalUrl: null,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function buildProductionBaseline({
  origin = DEFAULT_ORIGIN,
  fetchImpl = fetch,
  concurrency = DEFAULT_CONCURRENCY,
  redirectEntrypoints = [
    "http://ayprom-gidravlika.kg/",
    "http://www.ayprom-gidravlika.kg/",
    "https://ayprom-gidravlika.kg/",
  ],
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalizedOrigin = new URL(origin).origin;
  const sitemapUrl = `${normalizedOrigin}/sitemap.xml`;
  const robotsUrl = `${normalizedOrigin}/robots.txt`;

  const [sitemapResponse, robotsResponse] = await Promise.all([
    fetchGet(fetchImpl, sitemapUrl),
    fetchGet(fetchImpl, robotsUrl),
  ]);
  const [sitemapXml, robotsText] = await Promise.all([
    sitemapResponse.text(),
    robotsResponse.text(),
  ]);
  const sitemapUrls = parseSitemapUrls(sitemapXml);
  const sameOriginUrls = sitemapUrls.filter((url) => {
    try {
      return new URL(url).origin === normalizedOrigin;
    } catch {
      return false;
    }
  });

  const pages = await runWithConcurrency(sameOriginUrls, concurrency, (url) => inspectPage(fetchImpl, url));
  const redirects = await runWithConcurrency(redirectEntrypoints, Math.min(concurrency, 2), async (url) => {
    try {
      return await fetchRedirectChain(fetchImpl, url);
    } catch (error) {
      return { requestedUrl: url, finalUrl: null, urls: [url], statuses: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  return {
    schemaVersion: 1,
    generatedAt,
    origin: normalizedOrigin,
    requestPolicy: { method: "GET", concurrency, timeoutMs: 20_000 },
    sitemap: {
      url: sitemapUrl,
      status: sitemapResponse.status,
      urlCount: sitemapUrls.length,
      uniqueUrlCount: new Set(sitemapUrls).size,
      sameOriginUrlCount: sameOriginUrls.length,
      externalOrInvalidUrls: sitemapUrls.filter((url) => !sameOriginUrls.includes(url)),
      sha256: createHash("sha256").update(sitemapXml).digest("hex"),
    },
    robots: {
      url: robotsUrl,
      status: robotsResponse.status,
      sha256: createHash("sha256").update(robotsText).digest("hex"),
      text: robotsText,
    },
    pages,
    redirects,
  };
}

function parseCliArguments(argv) {
  const options = { origin: DEFAULT_ORIGIN, concurrency: DEFAULT_CONCURRENCY, output: null, help: false };
  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--origin=")) options.origin = argument.slice("--origin=".length);
    else if (argument.startsWith("--concurrency=")) options.concurrency = Number(argument.slice("--concurrency=".length));
    else if (argument.startsWith("--output=")) options.output = argument.slice("--output=".length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) {
    throw new Error("--concurrency must be an integer from 1 to 8");
  }
  return options;
}

function printHelp() {
  console.log(`Read-only production baseline for the AYPROM Cloudflare migration.

Usage:
  node scripts/cloudflare-migration-baseline.mjs [options]

Options:
  --origin=<url>       Production origin (default: ${DEFAULT_ORIGIN})
  --concurrency=<n>    Concurrent GET requests, 1..8 (default: ${DEFAULT_CONCURRENCY})
  --output=<path>      Write JSON to a file; otherwise print to stdout
  --help               Show this help

The script performs GET requests only and never changes production.`);
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const baseline = await buildProductionBaseline(options);
  const json = `${JSON.stringify(baseline, null, 2)}\n`;
  if (options.output) {
    await writeFile(path.resolve(options.output), json, "utf8");
    console.error(`Baseline written to ${path.resolve(options.output)}`);
  } else {
    process.stdout.write(json);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

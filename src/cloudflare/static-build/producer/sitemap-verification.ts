import { DOMParser, onErrorStopParsing } from "@xmldom/xmldom";

// Compares crawled sitemap.xml with the explicit sitemapEntries list.
// XML element order does not matter. External entities and remote URLs are
// never loaded; a DOCTYPE or ENTITY declaration fails the check locally.

export interface SitemapFailure {
  url: string;
  rule:
    | "sitemap_url_missing"
    | "sitemap_url_unexpected"
    | "sitemap_url_duplicate"
    | "sitemap_url_origin"
    | "product_alias_in_sitemap"
    | "sitemap_external_entity"
    | "sitemap_malformed"
    | "sitemap_root"
    | "sitemap_missing";
}

export interface SitemapVerificationReport {
  schemaVersion: 1;
  ok: boolean;
  expected: number;
  found: number;
  failures: SitemapFailure[];
}

const XML_DECLARATION = /<!DOCTYPE|<!ENTITY/i;

export function expectedSitemapUrl(siteOrigin: string, pathname: string): string {
  return `${siteOrigin}${pathname === "/" ? "" : pathname}`;
}

export function verifySitemapXml(
  xml: string,
  expectedPaths: readonly string[],
  siteOrigin: string,
  aliasPaths: readonly string[] = [],
): SitemapVerificationReport {
  if (XML_DECLARATION.test(xml)) {
    return report(expectedPaths.length, 0, [{ url: "", rule: "sitemap_external_entity" }]);
  }
  const parsed = parseSitemap(xml);
  if (!parsed.ok) {
    return report(expectedPaths.length, 0, [{ url: "", rule: parsed.rule }]);
  }
  const locs = parsed.locs;
  const expected = new Set(expectedPaths.map((pathname) => expectedSitemapUrl(siteOrigin, pathname)));
  const aliases = new Set(aliasPaths.map((pathname) => expectedSitemapUrl(siteOrigin, pathname)));
  const counts = new Map<string, number>();
  const failures: SitemapFailure[] = [];

  for (const url of locs) {
    counts.set(url, (counts.get(url) ?? 0) + 1);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      failures.push({ url: "", rule: "sitemap_url_origin" });
      continue;
    }
    if (parsed.origin !== new URL(siteOrigin).origin) {
      failures.push({ url: publicUrl(parsed), rule: "sitemap_url_origin" });
      continue;
    }
    if (aliases.has(url)) failures.push({ url: publicUrl(parsed), rule: "product_alias_in_sitemap" });
    else if (!expected.has(url)) failures.push({ url: publicUrl(parsed), rule: "sitemap_url_unexpected" });
  }
  for (const [url, count] of counts) {
    if (count > 1) failures.push({ url: diagnosticUrl(url), rule: "sitemap_url_duplicate" });
  }
  for (const url of expected) {
    if (!counts.has(url)) failures.push({ url, rule: "sitemap_url_missing" });
  }

  return report(expected.size, locs.length, failures);
}

export function serializeSitemapVerification(report: SitemapVerificationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function report(expected: number, found: number, failures: SitemapFailure[]): SitemapVerificationReport {
  return {
    schemaVersion: 1,
    ok: failures.length === 0,
    expected,
    found,
    failures: [...failures].sort((left, right) =>
      left.rule < right.rule ? -1 : left.rule > right.rule ? 1 : left.url < right.url ? -1 : left.url > right.url ? 1 : 0),
  };
}

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

function parseSitemap(xml: string): { ok: true; locs: string[] } | { ok: false; rule: "sitemap_malformed" | "sitemap_root" } {
  let document: ReturnType<DOMParser["parseFromString"]>;
  try {
    document = new DOMParser({ onError: onErrorStopParsing }).parseFromString(xml, "application/xml");
  } catch {
    const root = firstElementName(xml);
    if (root && root !== "urlset" && !root.endsWith(":urlset")) return { ok: false, rule: "sitemap_root" };
    return { ok: false, rule: "sitemap_malformed" };
  }
  if (document.getElementsByTagName("parsererror").length > 0 || document.doctype) {
    return { ok: false, rule: "sitemap_malformed" };
  }
  const root = document.documentElement;
  if (!root || !isSitemapElement(root, "urlset")) return { ok: false, rule: "sitemap_root" };
  const locs: string[] = [];
  for (const child of elementChildren(root)) {
    if (!isSitemapElement(child, "url")) return { ok: false, rule: "sitemap_malformed" };
    const pageLocs = elementChildren(child).filter((node) => isSitemapElement(node, "loc"));
    if (pageLocs.length !== 1) return { ok: false, rule: "sitemap_malformed" };
    const value = (pageLocs[0]?.textContent ?? "").trim();
    if (value === "") return { ok: false, rule: "sitemap_malformed" };
    locs.push(value);
  }
  return { ok: true, locs };
}

function isSitemapElement(node: { localName: string | null; namespaceURI: string | null }, localName: string): boolean {
  return node.localName === localName && (node.namespaceURI === null || node.namespaceURI === SITEMAP_NS);
}

type SitemapNode = {
  localName: string | null;
  namespaceURI: string | null;
  textContent: string | null;
  nodeType: number;
  childNodes: { length: number; item(index: number): SitemapNode | null };
};

function elementChildren(node: { childNodes: SitemapNode["childNodes"] }): SitemapNode[] {
  const children: SitemapNode[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes.item(index);
    if (child && child.nodeType === 1) children.push(child);
  }
  return children;
}

function firstElementName(xml: string): string | null {
  const match = xml.match(/<(?!\/|\?|!)([^\s/>]+)/);
  return match?.[1] ?? null;
}

function publicUrl(parsed: URL): string {
  return `${parsed.origin}${parsed.pathname}`;
}

function diagnosticUrl(raw: string): string {
  try {
    return publicUrl(new URL(raw));
  } catch {
    return "";
  }
}

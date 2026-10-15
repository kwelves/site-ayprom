// Pure helpers for comparing two builds of the same site page by page (the live Vercel site and the Cloudflare one):
// what a visitor and a search engine see (title, description, canonical, Open Graph, structured data, product links),
// without the parts that legitimately differ between builds (build ids, scripts, hashes).
const ENTITIES = { "&amp;": "&", "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const decode = (text) => text.replace(/&(?:amp|quot|#x27|#39|lt|gt);/g, (match) => ENTITIES[match]);

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}=("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? decode(match[2] ?? match[3]) : null;
}

function metaContent(html, key, value) {
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    if (attribute(tag, key)?.toLowerCase() === value) return attribute(tag, "content");
  }
  return null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  return value;
}

export function extractSignals(html) {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const canonicalTag = (html.match(/<link\s[^>]*>/gi) ?? []).find((tag) => attribute(tag, "rel")?.toLowerCase() === "canonical");
  const og = {};
  for (const name of ["title", "description", "image"]) {
    const content = metaContent(html, "property", `og:${name}`);
    if (content !== null) og[name] = content;
  }
  const jsonLd = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { jsonLd.push(canonicalJson(JSON.parse(match[1]))); } catch { jsonLd.push({ unparsable: true }); }
  }
  const productLinks = [];
  for (const match of html.matchAll(/href="(\/catalog\/category\/[^\/"?#]+\/[^\/"?#]+)"/g)) {
    if (!productLinks.includes(match[1])) productLinks.push(match[1]);
  }
  return {
    title: title ? decode(title[1]) : null,
    description: metaContent(html, "name", "description"),
    canonical: canonicalTag ? attribute(canonicalTag, "href") : null,
    og,
    jsonLd,
    productLinks,
  };
}

/** A redirect to the site's own address and a relative one are the same redirect. */
export function normalizeLocation(location) {
  if (location === null || location === undefined) return null;
  return location.replace(/^https:\/\/(?:www\.ayprom-gidravlika\.kg|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev)(?=\/|$)/i, "") || "/";
}

/** Every field that differs between two answers, as { field, a, b }. */
export function diffSignals(metaA, metaB, a, b) {
  const differences = [];
  const compare = (field, x, y) => { if (JSON.stringify(x) !== JSON.stringify(y)) differences.push({ field, a: x, b: y }); };
  compare("status", metaA.status, metaB.status);
  compare("location", normalizeLocation(metaA.location), normalizeLocation(metaB.location));
  compare("title", a.title, b.title);
  compare("description", a.description, b.description);
  compare("canonical", a.canonical, b.canonical);
  for (const name of new Set([...Object.keys(a.og), ...Object.keys(b.og)])) compare(`og.${name}`, a.og[name] ?? null, b.og[name] ?? null);
  compare("jsonLd", a.jsonLd, b.jsonLd);
  compare("productLinks", [...a.productLinks].sort(), [...b.productLinks].sort());
  return differences;
}

// Compares two builds of the site page by page: every address of the first site's sitemap (plus extra paths), asked of
// both, without following redirects. Read-only: it only sends GET requests.
// Usage: node scripts/cloudflare/compare-sites.mjs <baseA> <baseB> [--extra=/path,/other] [--concurrency=6]
//   baseA is the reference (the live site), baseB the candidate (e.g. https://ayprom-public.<subdomain>.workers.dev).
import { diffSignals, extractSignals } from "./compare-sites-lib.mjs";

const args = process.argv.slice(2);
const bases = args.filter((arg) => arg.startsWith("http")).map((arg) => arg.replace(/\/$/, ""));
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (bases.length !== 2) throw new Error("usage: compare-sites.mjs <baseA> <baseB> [--extra=/a,/b] [--concurrency=6]");
const [A, B] = bases;
const concurrency = Number(option("concurrency") ?? 6);

async function fetchPage(base, path) {
  try {
    const response = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    const html = response.status === 200 ? await response.text() : (await response.text(), "");
    return { meta: { status: response.status, location: response.headers.get("location") }, signals: extractSignals(html) };
  } catch (error) {
    return { meta: { status: `error:${error.name}`, location: null }, signals: extractSignals("") };
  }
}

const sitemap = await (await fetch(`${A}/sitemap.xml`)).text();
const paths = [...new Set([
  ...[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname),
  ...(option("extra")?.split(",").filter(Boolean) ?? []),
  "/robots.txt", "/sitemap.xml", "/api/health",
])];
console.log(`comparing ${paths.length} addresses: A=${A}  B=${B}`);

const results = [];
let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < paths.length) {
    const path = paths[next++];
    const [a, b] = await Promise.all([fetchPage(A, path), fetchPage(B, path)]);
    const differences = diffSignals(a.meta, b.meta, a.signals, b.signals);
    results.push({ path, status: a.meta.status, differences });
  }
}));

const different = results.filter((result) => result.differences.length > 0).sort((x, y) => x.path.localeCompare(y.path));
const byField = {};
for (const { differences } of different) for (const { field } of differences) byField[field] = (byField[field] ?? 0) + 1;
console.log(`identical: ${results.length - different.length} | different: ${different.length}`);
if (different.length > 0) console.log("different fields:", JSON.stringify(byField));
for (const { path, differences } of different.slice(0, 25)) {
  console.log(`\n${path}`);
  for (const { field, a, b } of differences) console.log(`  ${field}: A=${JSON.stringify(a)?.slice(0, 140)}  B=${JSON.stringify(b)?.slice(0, 140)}`);
}
if (different.length > 25) console.log(`\n... and ${different.length - 25} more addresses`);
process.exitCode = different.length > 0 ? 1 : 0;

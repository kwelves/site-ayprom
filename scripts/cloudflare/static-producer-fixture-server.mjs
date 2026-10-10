// Loopback fixture server for the static producer.
//
// Stands in for `next start` so the producer's child-process lifecycle, crawl
// and staging logic can be exercised against a real HTTP server and a real
// child process without Next, Supabase or any environment file. It serves the
// static/query routes of a route manifest as minimal HTML documents, robots.txt,
// sitemap.xml, a real 404 for unknown paths and 308 for product aliases.
//
// Behaviour flags exist only to provoke failure paths in tests:
//   --manifest <path>          route-manifest.json produced by the producer (required)
//   --site-url <origin>        canonical origin written into HTML (required)
//   --port <n>                 loopback port, default 0 (ephemeral, no port race)
//   --status <path>=<code>     answer this path with the given status (repeatable)
//   --delay <path>=<ms>        delay this path's response (repeatable)
//   --redirect <path>=<target> answer this path with 302 Location: target (repeatable)
//   --body-bytes <path>=<n>    answer this path with an n-byte text body (repeatable)
//   --content-type <path>=<t>  override the content type for this path (repeatable)
//   --never-ready              listen but never print the ready line
//   --exit-early <code>        exit immediately with the given code
//   --ignore-sigterm           keep running after SIGTERM (POSIX stop-timeout tests)
import http from "node:http";
import { readFileSync } from "node:fs";

const options = parseArgs(process.argv.slice(2));

if (options.exitEarly !== null) {
  process.exit(options.exitEarly);
}
if (!options.manifest || !options.siteUrl) {
  process.stderr.write("static-producer-fixture-server: --manifest and --site-url are required\n");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(options.manifest, "utf8"));
const documents = new Map();
const redirects = new Map();
for (const entry of manifest.entries) {
  if (entry.class === "static" || entry.class === "query") documents.set(entry.path, entry);
  if (entry.class === "redirect") redirects.set(entry.path, entry);
}
const sitemapPaths = options.sitemap
  ? JSON.parse(readFileSync(options.sitemap, "utf8"))
  : [...documents.keys()].filter((routePath) => !["/404", "/robots.txt", "/sitemap.xml"].includes(routePath)).sort();
if (options.corruptSitemap) sitemapPaths.push("/not-in-the-expected-list");

const server = http.createServer((request, response) => {
  const routePath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const respond = () => {
    const forcedStatus = options.status.get(routePath);
    const redirectTarget = options.redirect.get(routePath);
    const bodyBytes = options.bodyBytes.get(routePath);
    const contentTypeOverride = options.contentType.get(routePath);

    if (redirectTarget !== undefined) {
      response.writeHead(302, { location: redirectTarget, "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>redirect</title>");
      return;
    }
    if (bodyBytes !== undefined) {
      response.writeHead(forcedStatus ?? 200, { "content-type": contentTypeOverride ?? "text/html; charset=utf-8" });
      response.end("x".repeat(bodyBytes));
      return;
    }
    if (forcedStatus !== undefined) {
      response.writeHead(forcedStatus, { "content-type": contentTypeOverride ?? "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>status ${forcedStatus}</title>`);
      return;
    }

    if (routePath === "/robots.txt") {
      send(response, 200, contentTypeOverride ?? "text/plain; charset=utf-8",
        `User-agent: *\nAllow: /\nSitemap: ${options.siteUrl}/sitemap.xml\n`);
      return;
    }
    if (routePath === "/sitemap.xml") {
      const urls = sitemapPaths.map((path) =>
        `  <url><loc>${options.siteUrl}${path === "/" ? "" : path}</loc></url>`).join("\n");
      send(response, 200, contentTypeOverride ?? "application/xml",
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
      return;
    }
    const redirect = redirects.get(routePath);
    if (redirect) {
      response.writeHead(redirect.status, { location: redirect.redirectTo });
      response.end();
      return;
    }
    const document = documents.get(routePath);
    if (document && routePath !== "/404") {
      send(response, 200, contentTypeOverride ?? "text/html; charset=utf-8", renderDocument(document));
      return;
    }
    send(response, 404, contentTypeOverride ?? "text/html; charset=utf-8",
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Страница не найдена — AYPROM</title>` +
      `<meta name="robots" content="noindex"></head><body><h1>Страница не найдена</h1></body></html>`);
  };

  const delay = options.delay.get(routePath);
  if (delay) setTimeout(respond, delay);
  else respond();
});

server.on("error", (error) => {
  process.stderr.write(`static-producer-fixture-server: listen failed (${error.code ?? "unknown"})\n`);
  process.exit(1);
});

server.listen(options.port, "127.0.0.1", () => {
  const address = server.address();
  if (!options.neverReady) {
    process.stdout.write(`Ready on http://127.0.0.1:${address.port}\n`);
  }
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (options.ignoreSigterm) return;
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}

function renderDocument(entry) {
  const title = entry.path === "/" ? "AYPROM" : `${entry.path.split("/").filter(Boolean).join(" / ")} — AYPROM`;
  const jsonLd = entry.expectedJsonLdTypes.map((type) =>
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": type })}</script>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title>` +
    `<link rel="canonical" href="${entry.expectedCanonical}">${jsonLd}</head>` +
    `<body><h1>${title}</h1><main id="page" data-route-family="${entry.family}" data-route-class="${entry.class}">` +
    `<a href="/catalog">Каталог</a><a href="/catalog?q=1">Поиск</a><a href="#page">К началу</a>` +
    (options.corruptLink ? `<a href="/missing-internal">Нет</a>` : "") +
    (options.corruptEncoding ? `<a href="/bad%ZZ">Битая</a>` : "") +
    `</main></body></html>`;
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function parseArgs(argv) {
  const parsed = {
    manifest: null,
    sitemap: null,
    siteUrl: null,
    port: 0,
    status: new Map(),
    delay: new Map(),
    redirect: new Map(),
    bodyBytes: new Map(),
    contentType: new Map(),
    neverReady: false,
    corruptSitemap: false,
    corruptLink: false,
    corruptEncoding: false,
    exitEarly: null,
    ignoreSigterm: false,
  };
  const pair = (value) => {
    const separator = value.indexOf("=");
    return [value.slice(0, separator), value.slice(separator + 1)];
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => argv[++index];
    switch (flag) {
      case "--manifest": parsed.manifest = next(); break;
      case "--sitemap": parsed.sitemap = next(); break;
      case "--site-url": parsed.siteUrl = next(); break;
      case "--port": parsed.port = Number(next()); break;
      case "--status": { const [path, code] = pair(next()); parsed.status.set(path, Number(code)); break; }
      case "--delay": { const [path, ms] = pair(next()); parsed.delay.set(path, Number(ms)); break; }
      case "--redirect": { const [path, target] = pair(next()); parsed.redirect.set(path, target); break; }
      case "--body-bytes": { const [path, bytes] = pair(next()); parsed.bodyBytes.set(path, Number(bytes)); break; }
      case "--content-type": { const [path, type] = pair(next()); parsed.contentType.set(path, type); break; }
      case "--never-ready": parsed.neverReady = true; break;
      case "--corrupt-sitemap": parsed.corruptSitemap = true; break;
      case "--corrupt-link": parsed.corruptLink = true; break;
      case "--corrupt-encoding": parsed.corruptEncoding = true; break;
      case "--exit-early": parsed.exitEarly = Number(next()); break;
      case "--ignore-sigterm": parsed.ignoreSigterm = true; break;
      default:
        process.stderr.write(`static-producer-fixture-server: unknown flag ${flag}\n`);
        process.exit(2);
    }
  }
  return parsed;
}

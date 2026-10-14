import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { probePinnedCatalogBrowser } from "../scripts/cloudflare/pinned-catalog-browser-probe.mjs";

const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const catalog = `<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body>
  <h1>Каталог</h1>
  <form action="/catalog"><input aria-label="Поиск по каталогу" name="q"><button>Найти</button></form>
  <div id="results"></div>
  <script>
    async function search(q) {
      const response = await fetch('/api/catalog/search?q=' + encodeURIComponent(q));
      const data = await response.json();
      document.querySelector('#results').innerHTML = data.items.length
        ? '<a href="/catalog/category/pto/shaft">' + data.items[0].name + '</a>'
        : '<p>Ничего не найдено</p>';
    }
    document.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const q = document.querySelector('input').value;
      history.pushState(null, '', '/catalog?q=' + encodeURIComponent(q));
      search(q);
    });
    const q = new URL(location.href).searchParams.get('q');
    if (q) search(q);
  </script>
</body></html>`;

async function fixture({ interactive = true, leak = false } = {}) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/catalog/search") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ page: 1, total: url.searchParams.get("q") === "val" ? 1 : 0,
        totalPages: 1, items: url.searchParams.get("q") === "val"
          ? [{ slug: "shaft", name: "Вал", ...(leak ? { publication_capability: "fixture-secret-capability" } : {}) }] : [] }));
      return;
    }
    if (url.pathname === "/catalog/category/pto/shaft") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<h1>Вал</h1>");
      return;
    }
    if (url.pathname === "/catalog") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(interactive ? catalog : "<h1>Каталог</h1>");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture_port_missing");
  return `http://127.0.0.1:${address.port}`;
}

describe("pinned catalog browser probe", () => {
  it("uses the real browser to search, reload, open the product and see an empty result", async () => {
    const baseUrl = await fixture();
    const result = await probePinnedCatalogBrowser({ baseUrl, query: "val", expectedName: "Вал",
      expectedSlug: "shaft", productPath: "/catalog/category/pto/shaft",
      sensitiveValue: "fixture-secret-capability" });
    expect(result).toMatchObject({ ok: true, checks: ["search", "reload", "product", "empty"] });
    expect(JSON.stringify(result)).not.toContain("fixture-secret-capability");
  }, 30_000);

  it("fails closed when the page never calls the search API", async () => {
    const baseUrl = await fixture({ interactive: false });
    await expect(probePinnedCatalogBrowser({ baseUrl, query: "val", expectedName: "Вал",
      expectedSlug: "shaft", productPath: "/catalog/category/pto/shaft",
      sensitiveValue: "fixture-secret-capability", timeoutMs: 2_000 })).rejects.toThrow("pinned_browser_probe_failed");
  }, 20_000);

  it("fails closed if the public search response exposes the publication capability", async () => {
    const baseUrl = await fixture({ leak: true });
    await expect(probePinnedCatalogBrowser({ baseUrl, query: "val", expectedName: "Вал",
      expectedSlug: "shaft", productPath: "/catalog/category/pto/shaft",
      sensitiveValue: "fixture-secret-capability" })).rejects.toThrow("pinned_browser_probe_failed");
  }, 30_000);
});

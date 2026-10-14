import { describe, expect, it } from "vitest";

import {
  buildProductionBaseline,
  extractHtmlSignals,
  parseSitemapUrls,
  runWithConcurrency,
} from "../scripts/cloudflare-migration-baseline.mjs";

describe("Cloudflare migration production baseline", () => {
  it("извлекает и дедуплицирует URL из sitemap", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://www.ayprom-gidravlika.kg/</loc></url>
        <url><loc>https://www.ayprom-gidravlika.kg/catalog?a=1&amp;b=2</loc></url>
        <url><loc>https://www.ayprom-gidravlika.kg/</loc></url>
      </urlset>`;

    expect(parseSitemapUrls(xml)).toEqual([
      "https://www.ayprom-gidravlika.kg/",
      "https://www.ayprom-gidravlika.kg/catalog?a=1&b=2",
    ]);
  });

  it("снимает SEO- и HTML-сигналы без сохранения содержимого страницы", () => {
    const html = `<!doctype html><html><head>
      <title>Каталог — AYPROM</title>
      <meta name="description" content="Каталог гидравлики">
      <meta name="robots" content="index, follow">
      <link rel="canonical" href="https://www.ayprom-gidravlika.kg/catalog">
      <meta property="og:title" content="Каталог">
      <meta property="og:image" content="https://media.ayprom-gidravlika.kg/catalog.webp">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script>
    </head><body><h1>Все товары</h1><h2>Насосы</h2><a href="/contacts">Контакты</a></body></html>`;

    expect(extractHtmlSignals(html)).toMatchObject({
      title: "Каталог — AYPROM",
      description: "Каталог гидравлики",
      robots: "index, follow",
      canonical: "https://www.ayprom-gidravlika.kg/catalog",
      ogTitle: "Каталог",
      ogImage: "https://media.ayprom-gidravlika.kg/catalog.webp",
      h1: ["Все товары"],
      h2: ["Насосы"],
      internalLinks: ["/contacts"],
      jsonLdTypes: ["BreadcrumbList"],
    });
    expect(extractHtmlSignals(html).htmlBytes).toBeGreaterThan(0);
    expect(extractHtmlSignals(html).htmlSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("ограничивает конкурентность и сохраняет порядок результатов", async () => {
    let active = 0;
    let maximum = 0;
    const result = await runWithConcurrency([30, 5, 15, 1], 2, async (delay: number) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return delay;
    });

    expect(maximum).toBe(2);
    expect(result).toEqual([30, 5, 15, 1]);
  });

  it("строит baseline только из GET-запросов и фиксирует redirect chain", async () => {
    const calls: Array<{ url: string; method?: string; redirect?: string }> = [];
    const pages = new Map<string, { status: number; location?: string; body?: string }>([
      ["https://www.ayprom-gidravlika.kg/sitemap.xml", {
        status: 200,
        body: `<urlset><url><loc>https://www.ayprom-gidravlika.kg/</loc></url></urlset>`,
      }],
      ["https://www.ayprom-gidravlika.kg/robots.txt", {
        status: 200,
        body: "User-Agent: *\nAllow: /\n",
      }],
      ["https://www.ayprom-gidravlika.kg/", {
        status: 200,
        body: `<html><head><title>AYPROM</title><link rel="canonical" href="https://www.ayprom-gidravlika.kg/"></head><body><h1>AYPROM</h1></body></html>`,
      }],
      ["http://ayprom-gidravlika.kg/", {
        status: 308,
        location: "https://ayprom-gidravlika.kg/",
      }],
      ["https://ayprom-gidravlika.kg/", {
        status: 308,
        location: "https://www.ayprom-gidravlika.kg/",
      }],
    ]);

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method, redirect: init?.redirect });
      const item = pages.get(url);
      if (!item) throw new Error(`Unexpected URL: ${url}`);
      return new Response(item.body ?? "", {
        status: item.status,
        headers: item.location ? { location: item.location } : undefined,
      });
    };

    const baseline = await buildProductionBaseline({
      origin: "https://www.ayprom-gidravlika.kg",
      fetchImpl,
      concurrency: 2,
      redirectEntrypoints: ["http://ayprom-gidravlika.kg/"],
      generatedAt: "2026-09-19T00:00:00.000Z",
    });

    expect(calls.every((call) => !call.method || call.method === "GET")).toBe(true);
    expect(baseline.generatedAt).toBe("2026-09-19T00:00:00.000Z");
    expect(baseline.sitemap).toMatchObject({ status: 200, urlCount: 1, uniqueUrlCount: 1 });
    expect(baseline.pages[0]).toMatchObject({
      requestedUrl: "https://www.ayprom-gidravlika.kg/",
      status: 200,
      canonical: "https://www.ayprom-gidravlika.kg/",
      h1: ["AYPROM"],
    });
    expect(baseline.redirects[0]).toMatchObject({
      requestedUrl: "http://ayprom-gidravlika.kg/",
      finalUrl: "https://www.ayprom-gidravlika.kg/",
      statuses: [308, 308, 200],
    });
  });
});

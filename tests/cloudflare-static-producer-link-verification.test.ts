import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyDocumentLinks, type LinkCheck } from "@/cloudflare/static-build/producer/link-verification";
import { runStaticProducer } from "@/cloudflare/static-build/producer/run";
import { fixtureProducerInput, makeTempRepo, SITE_URL } from "./cloudflare-static-producer-support";

const origin = SITE_URL;
const temps: string[] = [];

afterEach(() => {
  for (const directory of temps.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const pages = new Map<string, string>([
  ["/about", `<a id="title"></a><a href="/catalog">Каталог</a>`],
  ["/catalog", `<main id="top"></main>`],
  ["/catalog/category/fittings", `<a href="../pto">КОМ</a>`],
  ["/catalog/category/pto", `<main></main>`],
]);

function check(html: string, from = "/about", extra: Partial<Parameters<typeof verifyDocumentLinks>[0]> = {}): LinkCheck[] {
  return verifyDocumentLinks({
    html,
    from,
    siteOrigin: origin,
    pages,
    files: new Set(["/images/logo.svg"]),
    aliases: new Set(["/product/shaft"]),
    ...extra,
  });
}

describe("internal link verification", () => {
  it("accepts a manifest route, a relative link and a query on an existing page", () => {
    const links = check(`<a href="/catalog">Каталог</a><a href="catalog?token=secret-token">Поиск</a>`, "/");
    expect(links.map((link) => [link.to, link.status])).toEqual([
      ["/catalog", "resolved"],
      ["/catalog", "resolved"],
    ]);
    expect(JSON.stringify(links)).not.toContain("secret-token");
  });

  it("resolves a relative link from the current page url", () => {
    const links = check(`<a href="pto">КОМ</a>`, "/catalog/category/fittings");
    expect(links).toEqual([{ from: "/catalog/category/fittings", to: "/catalog/category/pto", status: "resolved" }]);
  });

  it("checks fragments that exist and reports a missing fragment without saving it", () => {
    const present = check(`<a href="#title">Заголовок</a><a href="/catalog#top">Верх</a>`);
    const missing = check(`<a href="#secret-fragment">Нет</a>`);
    expect(present.every((link) => link.status === "resolved")).toBe(true);
    expect(missing).toEqual([{ from: "/about", to: "/about", status: "broken", rule: "missing_fragment" }]);
    expect(JSON.stringify(missing)).not.toContain("secret-fragment");
  });

  it("reports a missing page and accepts a copied file", () => {
    const links = check(`<a href="/missing">Нет</a><a href="/images/logo.svg">Логотип</a>`);
    expect(links).toEqual([
      { from: "/about", to: "/images/logo.svg", status: "resolved" },
      { from: "/about", to: "/missing", status: "broken", rule: "missing_target" },
    ]);
  });

  it("marks a product alias as pending and does not fetch external or contact links", () => {
    const links = check(`<a href="/product/shaft">Товар</a><a href="https://example.com/a">Сайт</a><a href="mailto:a@b.c">Почта</a><a href="tel:+996">Тел</a>`);
    expect(links).toEqual([{ from: "/about", to: "/product/shaft", status: "pending" }]);
  });

  it("resolves an absolute same-origin link and reports a missing same-origin page", () => {
    const links = check(
      `<a href="${SITE_URL}/catalog">Есть</a><a href="${SITE_URL}/missing">Нет</a><a href="${SITE_URL}/catalog?q=1#top">С якорем</a><a href="//example.com/out">Внешняя</a><a href="https://example.com/a">Сайт</a>`,
    );
    expect(links).toEqual([
      { from: "/about", to: "/catalog", status: "resolved" },
      { from: "/about", to: "/catalog", status: "resolved" },
      { from: "/about", to: "/missing", status: "broken", rule: "missing_target" },
    ]);
    expect(JSON.stringify(links)).not.toContain("example.com");
  });

  it("records an invalid percent-encoding without throwing or keeping the raw value", () => {
    const links = check(`<a href="/bad%ZZ">Путь</a><a href="/about#%ZZ">Фрагмент</a>`);
    expect(links).toEqual([
      { from: "/about", to: "/about", status: "broken", rule: "invalid_link" },
      { from: "/about", to: "/about", status: "broken", rule: "invalid_link" },
    ]);
    expect(JSON.stringify(links)).not.toContain("%ZZ");
  });

  it("marks admin and api links as runtime exclusions", () => {
    const links = check(`<a href="/admin/products">Админ</a><a href="/api/catalog/search">API</a>`);
    expect(links).toEqual([
      { from: "/about", to: "/admin/products", status: "runtime_excluded" },
      { from: "/about", to: "/api/catalog/search", status: "runtime_excluded" },
    ]);
  });
});

describe("producer link gate", { timeout: 30_000 }, () => {
  it("fails a broken internal link without changing dist/site", async () => {
    const repo = makeTempRepo();
    temps.push(repo.repoRoot);
    const before = repo.siteSnapshot();
    const result = await runStaticProducer(fixtureProducerInput(repo, {}, ["--corrupt-link"]));
    expect(result).toMatchObject({ ok: false, code: "link_verification_failed" });
    if (result.ok || !result.stagingDir) return;
    const report = readFileSync(path.join(result.stagingDir, "meta", "link-verification.json"), "utf8");
    expect(report).toContain("missing_target");
    expect(report).not.toContain("<a ");
    expect(repo.siteSnapshot()).toEqual(before);
  });

  it("keeps a report when a link has invalid percent-encoding and does not change dist/site", async () => {
    const repo = makeTempRepo();
    temps.push(repo.repoRoot);
    const before = repo.siteSnapshot();
    const result = await runStaticProducer(fixtureProducerInput(repo, {}, ["--corrupt-encoding"]));
    expect(result).toMatchObject({ ok: false, code: "link_verification_failed" });
    if (result.ok || !result.stagingDir) return;
    const report = readFileSync(path.join(result.stagingDir, "meta", "link-verification.json"), "utf8");
    expect(report).toContain("invalid_link");
    expect(report).not.toContain("%ZZ");
    expect(repo.siteSnapshot()).toEqual(before);
  });
});

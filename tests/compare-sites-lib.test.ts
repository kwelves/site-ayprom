import { describe, expect, it } from "vitest";
import { diffSignals, extractSignals, normalizeLocation } from "../scripts/cloudflare/compare-sites-lib.mjs";

const page = (extra = "") => `<!doctype html><html lang="ru"><head>
<title>Каталог — AYPROM</title>
<meta name="description" content="Гидравлические запчасти">
<link rel="canonical" href="https://www.ayprom-gidravlika.kg/catalog">
<meta property="og:title" content="Каталог">
<meta property="og:description" content="Описание">
<meta property="og:image" content="https://media.ayprom-gidravlika.kg/og.png">
<script type="application/ld+json">{"@type":"Organization","name":"AYPROM","email":"info@ayprom-gidravlika.kg"}</script>
<script>self.__next_f.push([1,"build-specific-noise"])</script>
</head><body>
<a href="/catalog/category/pto/korobka-1">A</a><a href="/catalog/category/pto/korobka-2">B</a><a href="/about">About</a>
${extra}</body></html>`;

describe("extractSignals", () => {
  it("reads the title, description, canonical, Open Graph tags, structured data and product links", () => {
    const s = extractSignals(page());
    expect(s.title).toBe("Каталог — AYPROM");
    expect(s.description).toBe("Гидравлические запчасти");
    expect(s.canonical).toBe("https://www.ayprom-gidravlika.kg/catalog");
    expect(s.og).toEqual({ title: "Каталог", description: "Описание", image: "https://media.ayprom-gidravlika.kg/og.png" });
    expect(s.jsonLd).toEqual([{ "@type": "Organization", name: "AYPROM", email: "info@ayprom-gidravlika.kg" }]);
    expect(s.productLinks).toEqual(["/catalog/category/pto/korobka-1", "/catalog/category/pto/korobka-2"]);
  });

  it("ignores build-specific scripts and the order of structured-data keys", () => {
    const a = extractSignals(page());
    const b = extractSignals(page().replace('{"@type":"Organization","name":"AYPROM","email":"info@ayprom-gidravlika.kg"}', '{"email":"info@ayprom-gidravlika.kg","name":"AYPROM","@type":"Organization"}').replace("build-specific-noise", "another-build"));
    expect(diffSignals({ status: 200 }, { status: 200 }, a, b)).toEqual([]);
  });

  it("copes with a page that has none of those tags", () => {
    const s = extractSignals("<html><body>plain</body></html>");
    expect(s).toMatchObject({ title: null, description: null, canonical: null, og: {}, jsonLd: [], productLinks: [] });
  });
});

describe("diffSignals", () => {
  const base = { status: 200, location: null };
  it("names every field that differs", () => {
    const a = extractSignals(page());
    const b = extractSignals(page().replace("Каталог — AYPROM", "Другое").replace('content="Описание"', 'content="Иное"').replace("korobka-2", "korobka-3"));
    const differences = diffSignals(base, base, a, b).map((d: { field: string }) => d.field);
    expect(differences).toEqual(expect.arrayContaining(["title", "og.description", "productLinks"]));
  });

  it("compares status codes and redirect targets", () => {
    const a = extractSignals("");
    expect(diffSignals({ status: 308, location: "/x" }, { status: 200, location: null }, a, a).map((d: { field: string }) => d.field)).toEqual(["status", "location"]);
  });
});

describe("normalizeLocation", () => {
  it("treats an absolute redirect to the same host and a relative one as equal", () => {
    expect(normalizeLocation("https://www.ayprom-gidravlika.kg/catalog")).toBe("/catalog");
    expect(normalizeLocation("/catalog")).toBe("/catalog");
    expect(normalizeLocation(null)).toBeNull();
    expect(normalizeLocation("https://other.example/x")).toBe("https://other.example/x");
  });
});

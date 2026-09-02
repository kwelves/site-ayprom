import { describe, expect, it } from "vitest";
import { BRAND_SEO, getBrandSeo } from "@/lib/brand-seo";

// Шаблон title в (site)/layout.tsx дописывает « — AYPROM» к каждому заголовку,
// поэтому в поиске обрезается именно сумма, а не сам заголовок страницы.
const TITLE_SUFFIX = " — AYPROM";

const entries = Object.entries(BRAND_SEO);

describe("тексты страниц брендов", () => {
  it("покрывает все семнадцать брендов каталога", () => {
    expect(Object.keys(BRAND_SEO).sort()).toEqual(
      [
        "daf",
        "faw",
        "foton",
        "howo",
        "hyundai",
        "isuzu",
        "kamaz",
        "kia",
        "man",
        "maz",
        "mercedes-benz",
        "renault-trucks",
        "scania",
        "shacman",
        "sitrak",
        "volvo",
        "zf",
      ].sort(),
    );
  });

  it.each(entries)("%s: заголовок и описание помещаются в выдачу и называют город", (_slug, seo) => {
    expect((seo.title + TITLE_SUFFIX).length).toBeLessThanOrEqual(60);
    expect(seo.description.length).toBeLessThanOrEqual(160);
    expect(seo.title).toContain("Бишкеке");
    expect(seo.description).toContain("Бишкеке");
  });

  it.each(entries)("%s: абзац содержательный и обещает то же, что «О компании»", (_slug, seo) => {
    expect(seo.intro.length).toBeGreaterThan(250);
    expect(`${seo.description} ${seo.intro}`).toContain("гарантия 12 месяцев");
  });

  // Семнадцать страниц с одним шаблоном и подставленным названием — это
  // семнадцать почти одинаковых страниц. Тест держит тексты разными.
  it("не повторяет один и тот же текст на разных брендах", () => {
    const intros = entries.map(([, seo]) => seo.intro);
    const descriptions = entries.map(([, seo]) => seo.description);

    expect(new Set(intros).size).toBe(intros.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("называет реальные модели коробок передач из каталога", () => {
    expect(getBrandSeo("mercedes-benz")!.intro).toContain("Powershift");
    expect(getBrandSeo("volvo")!.intro).toContain("VT2214");
    expect(getBrandSeo("scania")!.intro).toContain("GRS-905");
    expect(getBrandSeo("hyundai")!.intro).toContain("HIDRAKA");
  });

  it("объясняет, что ZF — это коробка передач, а не марка грузовика", () => {
    expect(getBrandSeo("zf")!.intro).toContain("не грузовика");
  });

  it("возвращает null для неизвестного бренда, чтобы страница осталась прежней", () => {
    expect(getBrandSeo("zzz-nonexistent")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { VEHICLE_TYPE_SEO, getVehicleTypeSeo } from "@/lib/vehicle-type-seo";

// Шаблон title в (site)/layout.tsx дописывает « — AYPROM» к каждому заголовку,
// поэтому в поиске обрезается именно сумма, а не сам заголовок страницы.
const TITLE_SUFFIX = " — AYPROM";

const entries = Object.entries(VEHICLE_TYPE_SEO);

describe("тексты страниц по типу техники", () => {
  it("покрывает все пять типов техники", () => {
    expect(Object.keys(VEHICLE_TYPE_SEO).sort()).toEqual(
      ["avtovoz", "kran-manipulyator", "musorovoz", "samosval", "tyagach"].sort(),
    );
  });

  it.each(entries)("%s: заголовок и описание помещаются в выдачу без города", (_slug, seo) => {
    expect((seo.title + TITLE_SUFFIX).length).toBeLessThanOrEqual(60);
    expect(seo.description.length).toBeLessThanOrEqual(160);
    expect(seo.title).not.toContain("Бишкек");
    expect(seo.description).not.toContain("Бишкек");
  });

  it.each(entries)("%s: видимый абзац содержательный и обещает то же, что «О компании»", (_slug, seo) => {
    expect(seo.intro.length).toBeGreaterThan(200);
    expect(seo.intro).toMatch(/гаранти[яю].*12 месяцев/i);
    expect(seo.intro).toContain("по Кыргызстану и в страны СНГ");
    expect(seo.intro).not.toContain("Бишкек");
  });

  it("у «Тонара» тексты про тонар, хотя адрес страницы исторически tyagach", () => {
    const seo = getVehicleTypeSeo("tyagach")!;

    expect(seo.title).toContain("тонар");
    expect(seo.intro).toContain("полуприцеп");
  });

  it("возвращает null для неизвестного типа, чтобы страница осталась прежней", () => {
    expect(getVehicleTypeSeo("zzz-nonexistent")).toBeNull();
  });
});

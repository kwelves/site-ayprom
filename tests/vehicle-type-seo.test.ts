import { describe, expect, it } from "vitest";
import { getVehicleTypeSeo } from "@/lib/vehicle-type-seo";

// Шаблон title в (site)/layout.tsx дописывает « — AYPROM» к каждому заголовку,
// поэтому в поиске обрезается именно сумма, а не сам заголовок страницы.
const TITLE_SUFFIX = " — AYPROM";

describe("тексты страниц по типу техники", () => {
  it("даёт самосвалу заголовок и описание с географией", () => {
    const seo = getVehicleTypeSeo("samosval");

    expect(seo).not.toBeNull();
    expect(seo!.title).toContain("Бишкеке");
    expect(seo!.description).toContain("Бишкеке");
    expect(seo!.intro).toContain("гарантия 12 месяцев");
  });

  it("держит заголовок и описание в пределах, которые показывает поиск", () => {
    const seo = getVehicleTypeSeo("samosval")!;

    expect((seo.title + TITLE_SUFFIX).length).toBeLessThanOrEqual(60);
    expect(seo.description.length).toBeLessThanOrEqual(160);
  });

  it("возвращает null для типов без своего текста, чтобы страница осталась прежней", () => {
    expect(getVehicleTypeSeo("avtovoz")).toBeNull();
    expect(getVehicleTypeSeo("zzz-nonexistent")).toBeNull();
  });
});

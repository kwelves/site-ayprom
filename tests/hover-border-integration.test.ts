import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFileSync(path.join(process.cwd(), relativePath), "utf8");

const sharedCardComponents = [
  "src/components/home/CategoryCard.tsx",
  "src/components/home/BrandCard.tsx",
  "src/components/catalog/ProductCard.tsx",
] as const;

const gridSurfaces = [
  "src/components/home/CategoryHoverGrid.tsx",
  "src/components/home/BrandSection.tsx",
  "src/components/catalog/ProductGridWithSearch.tsx",
  "src/components/catalog/ProductDetail.tsx",
  "src/app/(site)/catalog/category/[slug]/page.tsx",
  "src/app/(site)/catalog/brand/[slug]/page.tsx",
  "src/app/(site)/catalog/brand/[slug]/category/[categorySlug]/page.tsx",
  "src/app/(site)/contacts/page.tsx",
] as const;

const interactiveCardSurfaces = [
  ...sharedCardComponents,
  "src/components/home/CategoryHoverGrid.tsx",
  "src/components/home/BrandSection.tsx",
  "src/app/(site)/contacts/page.tsx",
] as const;

describe("единый hover-border публичных карточек", () => {
  it("хранит цвета края и подложки в отдельных семантических токенах", () => {
    expect(read("src/app/globals.css")).toContain(
      "--color-card-hover-highlight: color-mix(in oklab, var(--color-primary) 25%, transparent);",
    );
    expect(read("src/app/globals.css")).toContain(
      "--color-card-edge: color-mix(in oklab, var(--color-primary) 25%, transparent);",
    );
    const component = read("src/components/motion/HoverBorderGrid.tsx");
    expect(component).toContain("bg-card-hover-highlight");
    expect(component).not.toContain("bg-primary/25");
  });

  it.each(interactiveCardSurfaces)("%s использует единый цвет края карточки", (file) => {
    expect(read(file)).toContain("border-card-edge");
  });

  it.each(sharedCardComponents)("%s подключает карточку к общему контейнеру", (file) => {
    expect(read(file)).toContain("data-hover-border-item");
  });

  it.each(gridSurfaces)("%s использует HoverBorderGrid", (file) => {
    expect(read(file)).toContain("<HoverBorderGrid");
  });

  it("не складывает старый hover с общим движущимся эффектом", () => {
    const migratedSources = [...sharedCardComponents, ...gridSurfaces].map(read).join("\n");

    expect(migratedSources).not.toContain("hover:-translate-y-1");
    expect(migratedSources).not.toContain("hover:scale-[1.03]");
    expect(read("src/components/catalog/ProductCard.tsx")).not.toContain("hover:border-border-interactive");
    expect(read("src/app/(site)/contacts/page.tsx")).not.toContain("hover:border-border-interactive");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("vehicle showcase product-card layout", () => {
  it("uses height-aware desktop media without an implicit base zoom", () => {
    const css = readFileSync("src/components/home/vehicle-showcase/ProductPanel.module.css", "utf8");

    expect(css).not.toMatch(/\.baseZoom/);
    expect(css).toContain("height: clamp(10rem, min(38cqi, 32dvh), 20rem)");
    expect(css).not.toContain("height: clamp(13.75rem, 45cqi, 23.75rem)");
    expect(css).toContain("flex-wrap: wrap");
    expect(css).toContain("max-height: 20rem");
    expect(css).toContain("aspect-ratio: auto");
  });

  it("lets a low desktop viewport grow the section instead of clipping it", () => {
    const section = readFileSync("src/components/home/VehicleShowcaseSection.tsx", "utf8");
    const interactive = readFileSync("src/components/home/vehicle-showcase/VehicleShowcaseInteractive.tsx", "utf8");
    const panel = readFileSync("src/components/home/vehicle-showcase/ProductPanel.tsx", "utf8");
    const css = readFileSync("src/components/home/vehicle-showcase/ProductPanel.module.css", "utf8");

    expect(section).toContain("lg:min-h-[calc(100dvh-4rem+6rem)]");
    expect(section).not.toContain("lg:h-[calc(100dvh-4rem+6rem)]");
    expect(interactive).not.toContain("lg:flex-1 lg:overflow-hidden lg:p-1");
    expect(interactive).toContain('lg:min-h-[29rem]');
    expect(interactive).not.toContain('lg:h-[calc(100%-1rem)]');
    expect(panel).not.toContain('lg:h-full lg:min-h-[29rem]');
    expect(css).toContain("grid-template-rows: auto minmax(min-content, 1fr) auto");
    const layoutDeclarations = css.match(/\.layout\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(layoutDeclarations).not.toMatch(/(?:^|\n)\s*height:\s*100%/);
  });

  it("uses collision-safe warmup keys in both product galleries", () => {
    const catalogGallery = readFileSync("src/components/catalog/ProductGallery.tsx", "utf8");
    const hotspotPanel = readFileSync("src/components/home/vehicle-showcase/ProductPanel.tsx", "utf8");
    const keyExpression = 'key={`${images[neighborIndex].url}-${neighborIndex}`}';

    expect(catalogGallery).toContain(keyExpression);
    expect(hotspotPanel).toContain(keyExpression);
    expect(catalogGallery).not.toContain("scrollIntoView");
  });
});

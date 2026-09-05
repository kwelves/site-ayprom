// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VehicleShowcaseShell } from "@/components/home/vehicle-showcase/VehicleShowcaseShell";
import {
  SHOWCASE_CARD_CLASS,
  SHOWCASE_CAROUSEL_MASK_CLASS,
  SHOWCASE_GRID_CLASS,
  SHOWCASE_ROOT_CLASS,
  SHOWCASE_STAGE_CLASS,
} from "@/components/home/vehicle-showcase/showcase-geometry";
import type { VehicleVisual } from "@/components/home/vehicle-showcase/vehicle-visual";
import type { VehicleShowcaseEntry } from "@/lib/queries/vehicle-hotspots";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const entries = [
  {
    vehicleType: { slug: "kran-manipulyator", name: "Кран-манипулятор" },
    hotspots: [
      { id: "a", hotspotNumber: 1, label: "КОМ", xPct: 30, yPct: 40, product: null },
      { id: "b", hotspotNumber: 2, label: "Насос", xPct: 50, yPct: 40, product: null },
    ],
  },
  { vehicleType: { slug: "samosval", name: "Самосвал" }, hotspots: [] },
  { vehicleType: { slug: "tyagach", name: "Тонар" }, hotspots: [] },
] as unknown as VehicleShowcaseEntry[];

const visuals: Record<string, VehicleVisual> = {
  "kran-manipulyator": {
    image: "/images/vehicle-showcase/kran-manipulyator.webp",
    imageMobile: "/images/vehicle-showcase/kran-manipulyator-mobile.webp",
    naturalWidth: 1086,
    naturalHeight: 1448,
    scale: 1.8,
    desktopScale: 1.507,
  },
  samosval: { image: "/images/vehicle-showcase/samosval.webp", naturalWidth: 1086, naturalHeight: 1448 },
  tyagach: { image: "/images/vehicle-showcase/tyagach.webp", naturalWidth: 1086, naturalHeight: 1448 },
};

function shellMarkup() {
  return renderToString(
    <VehicleShowcaseShell entries={entries} visuals={visuals} defaultSlug="kran-manipulyator" />,
  );
}

describe("статическая витрина техники в исходном HTML", () => {
  it("содержит название техники, её фотографию и рабочие ссылки", () => {
    const markup = shellMarkup();

    expect(markup).toContain("Кран-манипулятор");
    expect(markup).toContain('href="/catalog/vehicle-type/kran-manipulyator"');
    // Ссылки на остальные типы техники остаются полезными даже без интерактива.
    expect(markup).toContain('href="/catalog/vehicle-type/samosval"');
    expect(markup).toContain('href="/catalog/vehicle-type/tyagach"');
    expect(markup).toContain("object-contain");
  });

  it("запрашивает ровно один вариант фотографии и только техники по умолчанию", () => {
    const markup = shellMarkup();

    // <picture>: десктопный вариант — в <source>, мобильный — в <img>. Браузер
    // берёт ровно один, оба одновременно не запрашиваются.
    expect(markup).toContain('media="(min-width: 1024px)"');
    expect(markup).toContain('srcSet="/images/vehicle-showcase/kran-manipulyator.webp"');
    expect(markup).toContain('src="/images/vehicle-showcase/kran-manipulyator-mobile.webp"');
    // Ни одной фотографии остальных машин.
    expect(markup).not.toContain("samosval.webp");
    expect(markup).not.toContain("tyagach.webp");
    expect(markup.match(/<img/g) ?? []).toHaveLength(1);
    // Витрина стоит сразу под первым экраном: её фото не должно соперничать
    // за канал с hero-видео.
    expect(markup).toContain('loading="lazy"');
  });

  it("сохраняет scale и desktopScale исходной сцены", () => {
    const markup = shellMarkup();

    expect(markup).toContain("--vehicle-shell-scale:1.8");
    expect(markup).toContain("--vehicle-shell-scale-lg:1.507");
    expect(readFileSync("src/app/globals.css", "utf8")).toContain("[data-vehicle-shell-image]");
  });

  it("резервирует ту же геометрию, что и интерактивная версия", () => {
    const markup = shellMarkup();
    const interactive = readFileSync(
      "src/components/home/vehicle-showcase/VehicleShowcaseInteractive.tsx",
      "utf8",
    );

    // Одни и те же строки классов, потому что источник у них один.
    expect(markup).toContain(SHOWCASE_GRID_CLASS);
    expect(markup).toContain(SHOWCASE_STAGE_CLASS);
    expect(markup).toContain(SHOWCASE_CARD_CLASS);
    expect(markup).toContain(SHOWCASE_CAROUSEL_MASK_CLASS);
    expect(SHOWCASE_CARD_CLASS).toContain("min-h-[220px]");
    expect(SHOWCASE_CARD_CLASS).toContain("lg:min-h-[29rem]");

    for (const constantName of [
      "SHOWCASE_GRID_CLASS",
      "SHOWCASE_STAGE_CLASS",
      "SHOWCASE_CARD_CLASS",
      "SHOWCASE_ROOT_CLASS",
    ]) {
      expect(interactive).toContain(constantName);
    }
    expect(SHOWCASE_ROOT_CLASS).toContain("lg:flex-1");
  });

  it("секция подключает заглушку через ленивый загрузчик, а не импортирует интерактив напрямую", () => {
    const section = readFileSync("src/components/home/VehicleShowcaseSection.tsx", "utf8");

    expect(section).toContain("<VehicleShowcaseLazy");
    expect(section).toContain("<VehicleShowcaseShell");
    expect(section).not.toContain('from "./vehicle-showcase/VehicleShowcaseInteractive"');
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductPanel } from "@/components/home/vehicle-showcase/ProductPanel";
import type { HotspotProduct } from "@/lib/queries/vehicle-hotspots";

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, useReducedMotion: () => false };
});

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("@/lib/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

afterEach(cleanup);

const product: HotspotProduct = {
  slug: "ay-gp110",
  name: "Шестерённый насос AY-GP110",
  shortDescription: "Насос для гидравлической системы",
  images: [
    { url: "/images/products/ay-gp110-1.webp" },
    { url: "/images/products/ay-gp110-2.webp" },
    { url: "/images/products/ay-gp110-3.webp" },
  ],
};

describe("ProductPanel", () => {
  it("keeps a stable mobile media frame and exposes separate 44px gallery controls", () => {
    render(<ProductPanel label="Гидронасос" product={product} vehicleTypeSlug="samosval" />);

    const media = screen.getByTestId("product-panel-media");
    expect([...media.classList]).toEqual(expect.arrayContaining(["aspect-square", "w-full", "max-w-[220px]"]));

    const previous = screen.getByRole("button", { name: "Предыдущее фото" });
    const next = screen.getByRole("button", { name: "Следующее фото" });
    expect([...previous.classList]).toEqual(expect.arrayContaining(["left-1", "h-11", "w-11"]));
    expect([...next.classList]).toEqual(expect.arrayContaining(["right-1", "h-11", "w-11"]));
    expect(previous).not.toBe(next);

    fireEvent.click(next);
    expect(screen.getByRole("button", { name: "Показать фото 1" }).getAttribute("aria-current")).toBe("false");
    expect(screen.getByRole("button", { name: "Показать фото 2" }).getAttribute("aria-current")).toBe("true");
  });

  it("hides gallery navigation for one image and keeps one visually primary action", () => {
    render(
      <ProductPanel
        label="Гидронасос"
        product={{ ...product, images: product.images.slice(0, 1) }}
        vehicleTypeSlug="samosval"
      />,
    );

    expect(screen.queryByRole("button", { name: "Предыдущее фото" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Следующее фото" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Показать фото/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Увеличить фото" })).toBeDefined();

    const details = screen.getByRole("link", { name: "Подробнее" });
    const catalog = screen.getByRole("link", { name: "В каталог" });
    expect(details.getAttribute("href")).toBe("/product/ay-gp110");
    expect(catalog.getAttribute("href")).toBe("/catalog/vehicle-type/samosval");
    expect([...details.classList]).toEqual(expect.arrayContaining(["bg-primary", "text-primary-foreground"]));
    expect([...catalog.classList]).toEqual(expect.arrayContaining(["border-primary", "bg-card", "text-primary"]));
    expect(catalog.classList).not.toContain("bg-primary");
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    { url: "/images/products/ay-gp110-1.webp", scale: 1.12 },
    { url: "/images/products/ay-gp110-2.webp" },
    { url: "/images/products/ay-gp110-3.webp" },
  ],
};

describe("ProductPanel", () => {
  it("keeps arrows and indicators outside the 4:3 media rect and switches the active image", () => {
    render(<ProductPanel label="Гидронасос" product={product} vehicleTypeSlug="samosval" />);

    const panel = screen.getByTestId("product-panel");
    const gallery = screen.getByTestId("product-gallery");
    const media = screen.getByTestId("product-panel-media");
    expect(panel.className).toBeTruthy();
    expect(panel.getAttribute("data-layout-scope")).toBe("product-panel");
    expect(gallery.getAttribute("data-gallery-layout")).toBe("controls-media-controls");
    expect(media.getAttribute("data-image-fit")).toBe("contain");
    const image = screen.getByAltText(product.name);
    expect(image.style.transform).toBe("scale(1.12)");
    expect(screen.queryByTestId("product-image-base-zoom")).toBeNull();

    const previous = screen.getByRole("button", { name: "Предыдущее фото" });
    const next = screen.getByRole("button", { name: "Следующее фото" });
    expect(previous.parentElement).toBe(gallery);
    expect(next.parentElement).toBe(gallery);
    expect(media.contains(previous)).toBe(false);
    expect(media.contains(next)).toBe(false);
    expect(screen.getByTestId("product-image-indicators").parentElement).toBe(gallery);
    expect(previous).not.toBe(next);

    fireEvent.click(next);
    expect(screen.getByRole("button", { name: "Показать фото 1" }).getAttribute("aria-current")).toBe("false");
    expect(screen.getByRole("button", { name: "Показать фото 2" }).getAttribute("aria-current")).toBe("true");
  });

  it("keeps the committed photo visible until the selected photo has loaded", async () => {
    render(<ProductPanel label="Гидронасос" product={product} vehicleTypeSlug="samosval" />);

    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" }));

    const committed = document.querySelector<HTMLElement>('[data-carousel-layer="committed"]');
    const pending = document.querySelector<HTMLElement>('[data-carousel-layer="pending"]');
    expect(committed?.querySelector("img")?.getAttribute("src")).toContain("ay-gp110-1.webp");
    expect(pending?.querySelector("img")?.getAttribute("src")).toContain("ay-gp110-2.webp");
    expect(committed).toBeTruthy();
    expect(pending).toBeTruthy();

    fireEvent.load(pending!.querySelector("img")!);

    await waitFor(() => {
      const layers = document.querySelectorAll('[data-carousel-layer="committed"]');
      expect(layers).toHaveLength(1);
      expect(layers[0].querySelector("img")?.getAttribute("src")).toContain("ay-gp110-2.webp");
    });
  });

  it("does not let a stale image load replace the latest rapid selection", () => {
    render(<ProductPanel label="Гидронасос" product={product} vehicleTypeSlug="samosval" />);

    const next = screen.getByRole("button", { name: "Следующее фото" });
    fireEvent.click(next);
    const staleImage = document.querySelector<HTMLElement>('[data-carousel-layer="pending"] img');
    fireEvent.click(next);

    fireEvent.load(staleImage!);

    const pending = document.querySelector<HTMLElement>('[data-carousel-layer="pending"]');
    expect(pending?.querySelector("img")?.getAttribute("src")).toContain("ay-gp110-3.webp");
    expect(document.querySelector<HTMLElement>('[data-carousel-layer="committed"] img')?.getAttribute("src")).toContain(
      "ay-gp110-1.webp",
    );
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

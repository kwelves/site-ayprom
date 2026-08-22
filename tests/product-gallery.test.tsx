// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductGallery } from "@/components/catalog/ProductGallery";

vi.mock("@/lib/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

afterEach(cleanup);

const images = [
  { url: "/images/products/one.webp" },
  { url: "/images/products/two.webp", scale: 1.1 },
  { url: "/images/products/three.webp" },
];

describe("ProductGallery", () => {
  it("keeps the previous mobile-carousel frame until the next one loads", async () => {
    render(<ProductGallery images={images} alt="Фото товара" />);

    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" }));

    const committed = document.querySelector<HTMLElement>('[data-carousel-layer="committed"]');
    const pending = document.querySelector<HTMLElement>('[data-carousel-layer="pending"]');
    expect(committed?.querySelector("img")?.getAttribute("src")).toContain("one.webp");
    expect(pending?.querySelector("img")?.getAttribute("src")).toContain("two.webp");

    fireEvent.load(pending!.querySelector("img")!);

    await waitFor(() => {
      expect(document.querySelectorAll('[data-carousel-layer="pending"]')).toHaveLength(0);
      expect(document.querySelector<HTMLElement>('[data-carousel-layer="committed"] img')?.style.transform).toBe(
        "scale(1.1)",
      );
    });
  });

  it("reveals a neutral fallback over the committed frame when the selected image fails", async () => {
    render(<ProductGallery images={images} alt="Фото товара" />);

    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" }));
    const pendingImage = document.querySelector<HTMLImageElement>('[data-carousel-layer="pending"] img');
    fireEvent.error(pendingImage!);

    await waitFor(() => {
      const committed = document.querySelector<HTMLElement>('[data-carousel-layer="committed"]');
      expect(committed?.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain(
        "Фотография пока не добавлена",
      );
    });
  });

  it("reveals and commits the fallback when the selected image URL is empty", async () => {
    render(<ProductGallery images={[images[0], { url: "" }]} alt="Фото товара" />);

    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" }));

    await waitFor(() => {
      const committed = document.querySelector<HTMLElement>('[data-carousel-layer="committed"]');
      expect(committed?.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain(
        "Фотография пока не добавлена",
      );
      expect(document.querySelector('[data-carousel-layer="pending"]')).toBeNull();
    });
  });

  it("does not render controls or neighbor warmups for one image", () => {
    render(<ProductGallery images={images.slice(0, 1)} alt="Фото товара" />);

    expect(screen.queryByRole("button", { name: "Предыдущее фото" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Следующее фото" })).toBeNull();
    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull();
  });

  it("keeps every indicator touch target at 44 by 44 pixels", () => {
    const tenImages = Array.from({ length: 10 }, (_, index) => ({ url: `/images/products/${index}.webp` }));
    render(<ProductGallery images={tenImages} alt="Фото товара" />);

    const scrollRegion = screen.getByTestId("product-gallery-indicator-scroll");
    expect(scrollRegion.classList).toContain("w-full");
    expect(scrollRegion.classList).toContain("max-w-full");
    expect(scrollRegion.classList).toContain("overflow-x-auto");
    expect(scrollRegion.firstElementChild?.classList).toContain("w-max");

    for (const indicator of screen.getAllByRole("button", { name: /Показать фото/ })) {
      expect(indicator.classList).toContain("h-11");
      expect(indicator.classList).toContain("w-11");
      expect(indicator.querySelector("span")?.classList).toContain("h-2");
    }
  });

  it("scrolls only the local indicator rail when the active dot leaves its viewport", async () => {
    const tenImages = Array.from({ length: 10 }, (_, index) => ({ url: `/images/products/${index}.webp` }));
    render(<ProductGallery images={tenImages} alt="Фото товара" />);

    const scrollRegion = screen.getByTestId("product-gallery-indicator-scroll");
    const thirdIndicator = screen.getByRole("button", { name: "Показать фото 3" });
    Object.defineProperty(scrollRegion, "clientWidth", { configurable: true, value: 88 });
    Object.defineProperty(scrollRegion, "scrollLeft", { configurable: true, value: 0, writable: true });
    Object.defineProperty(thirdIndicator, "offsetLeft", { configurable: true, value: 88 });
    Object.defineProperty(thirdIndicator, "offsetWidth", { configurable: true, value: 44 });
    const scrollTo = vi.fn();
    Object.defineProperty(scrollRegion, "scrollTo", { configurable: true, value: scrollTo });

    fireEvent.click(thirdIndicator);

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ left: 44, behavior: "smooth" });
    });
  });
});

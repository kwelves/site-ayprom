// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CARD_TITLE_CLASSNAME } from "@/lib/card-system";
import { ProductCard } from "@/components/catalog/ProductCard";
import type { ProductListItem } from "@/types/catalog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("@/lib/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

afterEach(cleanup);

const product: ProductListItem = {
  slug: "test-product",
  name: "Тестовый товар",
  category: "pto",
  compatibleBrands: [],
  shortDescription: "Описание",
  images: [
    { url: "/images/products/one.webp" },
    { url: "/images/products/two.webp" },
  ],
};

describe("ProductCard carousel", () => {
  it("даёт изображению область 4:3 с инсетом 16px на самой фото-зоне", () => {
    render(<ProductCard product={product} href="/product/test-product" />);

    const title = screen.getByText("Тестовый товар");
    const description = screen.getByText("Описание");
    const image = document.querySelector("img");
    const imageArea = document.querySelector(".aspect-4\\/3");
    const textBlock = title.parentElement;

    expect(imageArea).toBeTruthy();
    expect(document.querySelector(".aspect-square")).toBeNull();
    // Инсет на фото-зоне, а не на <img>: только так область изображения
    // остаётся ровно 4:3 и её край совпадает с px-4 текстового блока.
    expect(imageArea?.parentElement?.className).toContain("p-4");
    expect(image?.className).not.toContain("p-4");
    expect(image?.className).toContain("object-contain");
    expect(textBlock?.className).toContain("px-4 pt-2.5 pb-3 sm:pt-4 sm:pb-5");
    expect(title.className).toContain("text-sm font-semibold sm:text-base");
    expect(description.className).toContain("text-xs leading-4");
    expect(description.className).toContain("sm:text-sm sm:leading-relaxed");
  });

  it("keeps the decoded frame atomic instead of crossfading two products", async () => {
    render(<ProductCard product={product} href="/product/test-product" />);

    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" }));

    const committed = document.querySelector<HTMLElement>('[data-carousel-layer="committed"]');
    const pending = document.querySelector<HTMLElement>('[data-carousel-layer="pending"]');
    expect(committed?.querySelector("img")?.getAttribute("src")).toContain("one.webp");
    expect(pending?.querySelector("img")?.getAttribute("src")).toContain("two.webp");
    expect(pending?.style.visibility).toBe("hidden");
    expect(pending?.style.opacity).toBe("");
    expect(pending?.style.transform).toBe("");

    fireEvent.load(pending!.querySelector("img")!);

    await waitFor(() => {
      expect(document.querySelector('[data-carousel-layer="pending"]')).toBeNull();
      expect(document.querySelector<HTMLElement>('[data-carousel-layer="committed"] img')?.getAttribute("src")).toContain(
        "two.webp",
      );
    });
  });

  it("показывает компактную товарную карточку внутри сетки категории", () => {
    render(<ProductCard product={product} href="/product/test-product" variant="category-grid" />);

    const title = screen.getByText("Тестовый товар");
    const image = document.querySelector("img");

    expect(screen.getByText("Товар")).toBeTruthy();
    expect(screen.queryByText("Описание")).toBeNull();
    expect(document.querySelector(".aspect-4\\/3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Показать фото 1" })).toBeNull();
    // Обе разновидности карточки делят одну геометрию фото-зоны.
    expect(document.querySelector(".aspect-4\\/3")?.parentElement?.className).toContain("p-4");
    expect(image?.className).not.toContain("p-4");
    expect(title.className).toContain(CARD_TITLE_CLASSNAME);
    // Обложечный заголовок системы, а не полужирный заголовок обычной карточки.
    expect(title.className).not.toContain("font-semibold");
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});

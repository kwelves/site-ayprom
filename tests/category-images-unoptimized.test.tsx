// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryCard } from "@/components/home/CategoryCard";
import { CategoryHoverGrid } from "@/components/home/CategoryHoverGrid";
import type { Category } from "@/types/catalog";

vi.mock("next/image", () => ({
  default: ({ src, alt, unoptimized }: { src: string; alt: string; unoptimized?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element -- проверяем контракт next/image изолированным img
    <img src={src} alt={alt} data-unoptimized={String(unoptimized)} />
  ),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { span: (props: React.ComponentProps<"span">) => <span {...props} /> },
  useReducedMotion: () => false,
}));

vi.mock("@/components/motion/Stagger", () => ({
  StaggerGroup: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
  StaggerItem: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
}));

afterEach(cleanup);

const imageUrl =
  "https://project.supabase.co/storage/v1/object/public/category-images/hydraulic-pumps/example.jpg";

describe("category image delivery", () => {
  it("отдаёт изображение CategoryCard напрямую, без Vercel Image Optimization", () => {
    const view = render(<CategoryCard href="/catalog/category/hydraulic-pumps" image={imageUrl} name="Насосы" />);
    // alt намеренно пустой: название категории стоит видимым текстом под
    // фотографией, повтор читался бы скринридером дважды (image-redundant-alt).
    const image = view.container.querySelector("img")!;
    expect(image.getAttribute("alt")).toBe("");

    expect(image.getAttribute("src")).toBe(imageUrl);
    expect(image.getAttribute("data-unoptimized")).toBe("true");
  });

  it("отдаёт изображения главной сетки напрямую, без Vercel Image Optimization", () => {
    const category: Category = {
      slug: "hydraulic-pumps",
      name: "Насосы",
      description: "Гидравлические насосы",
      icon: "hydraulic-pump",
      image: imageUrl,
      type: "subcategory",
    };
    const view = render(<CategoryHoverGrid categories={[category]} />);
    const image = view.container.querySelector("img");

    expect(image?.getAttribute("src")).toBe(imageUrl);
    expect(image?.getAttribute("data-unoptimized")).toBe("true");
  });
});

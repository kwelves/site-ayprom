import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { galleryTargetFromUrl, needsGalleryRegeneration } = await import("@/lib/photo-queue/regenerate-gallery");

describe("перевод фото галереи на новый профиль", () => {
  it("берёт товар и папку фото из адреса старого варианта", () => {
    expect(
      galleryTargetFromUrl(
        "https://media.ayprom-gidravlika.kg/product-images/gear-pump/20323314-85a4-4e16-86c2-2cd71e9735d7/variants/v1/gallery-37c69c6096209fd1.webp",
      ),
    ).toEqual({ productSlug: "gear-pump", imageId: "20323314-85a4-4e16-86c2-2cd71e9735d7" });
    expect(galleryTargetFromUrl("https://media.example/product-images/gear-pump/master.jpg")).toBeNull();
  });

  it("пересоздаёт только то, что ещё не на текущей версии", () => {
    expect(needsGalleryRegeneration({ gallery_url: "https://m/product-images/a/b/variants/v1/gallery-0123456789abcdef.webp" })).toBe(true);
    expect(needsGalleryRegeneration({ gallery_url: "https://m/product-images/a/b/variants/v2/gallery-0123456789abcdef.webp" })).toBe(false);
    expect(needsGalleryRegeneration({ gallery_url: null })).toBe(true);
  });
});

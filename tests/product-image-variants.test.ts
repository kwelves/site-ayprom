import { describe, expect, it } from "vitest";
import {
  resolveCardImageUrl,
  resolveGalleryImageUrl,
  resolveImageFallbackUrl,
} from "@/lib/product-image-variants";

const master = "https://storage.example/master.jpg";
const thumbnail = "https://storage.example/variants/v1/thumbnail.webp";
const gallery = "https://storage.example/variants/v1/gallery.webp";

describe("resolveCardImageUrl", () => {
  it("выбирает thumbnail, когда оба варианта заполнены", () => {
    expect(resolveCardImageUrl({ url: master, thumbnail_url: thumbnail, gallery_url: gallery })).toBe(thumbnail);
  });

  it("падает на master, когда вариантов ещё нет", () => {
    expect(resolveCardImageUrl({ url: master })).toBe(master);
    expect(resolveCardImageUrl({ url: master, thumbnail_url: null, gallery_url: null })).toBe(master);
  });
});

describe("resolveGalleryImageUrl", () => {
  it("выбирает gallery, никогда не thumbnail", () => {
    expect(resolveGalleryImageUrl({ url: master, thumbnail_url: thumbnail, gallery_url: gallery })).toBe(gallery);
  });

  it("падает на master, когда gallery ещё нет", () => {
    expect(resolveGalleryImageUrl({ url: master })).toBe(master);
    expect(resolveGalleryImageUrl({ url: master, thumbnail_url: thumbnail, gallery_url: null })).toBe(master);
  });
});

describe("resolveImageFallbackUrl", () => {
  it("возвращает master, если выбранный вариант не master", () => {
    expect(resolveImageFallbackUrl({ url: master, thumbnail_url: thumbnail }, thumbnail)).toBe(master);
    expect(resolveImageFallbackUrl({ url: master, gallery_url: gallery }, gallery)).toBe(master);
  });

  it("возвращает undefined, если выбранный URL уже master — повторять нечем", () => {
    expect(resolveImageFallbackUrl({ url: master }, master)).toBeUndefined();
  });
});

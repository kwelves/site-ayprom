import { describe, expect, it } from "vitest";
import {
  buildR2ObjectKey,
  buildR2PublicUrl,
  locatePublicMediaObject,
  validateMediaObjectPath,
} from "@/lib/media-storage-core";

describe("media storage paths", () => {
  it("keeps buckets isolated under one R2 hostname", () => {
    expect(buildR2ObjectKey("product-images", "pump/id/master.png")).toBe(
      "product-images/pump/id/master.png",
    );
    expect(buildR2PublicUrl("https://media.example.com", "brand-logos", "bosch/logo.svg")).toBe(
      "https://media.example.com/brand-logos/bosch/logo.svg",
    );
  });

  it.each(["../secret", "a/../secret", "a//b", "a/./b", "\u0000bad"])(
    "rejects an unsafe path: %s",
    (path) => expect(() => validateMediaObjectPath(path)).toThrow("Некорректный путь"),
  );
});

describe("media URL ownership", () => {
  const common = {
    bucket: "product-images" as const,
    supabaseUrl: "https://project.supabase.co",
    r2PublicBaseUrl: "https://media.example.com",
  };

  it("recognizes exact Supabase and R2 origins", () => {
    expect(
      locatePublicMediaObject({
        ...common,
        publicUrl: "https://project.supabase.co/storage/v1/object/public/product-images/pump/a.webp",
      }),
    ).toMatchObject({ provider: "supabase", path: "pump/a.webp" });
    expect(
      locatePublicMediaObject({
        ...common,
        publicUrl: "https://media.example.com/product-images/pump/a.webp",
      }),
    ).toMatchObject({ provider: "r2", key: "product-images/pump/a.webp" });
  });

  it.each([
    "https://evil.example/product-images/pump/a.webp",
    "https://media.example.com.evil.test/product-images/pump/a.webp",
    "https://media.example.com/category-images/pump/a.webp",
    "not-a-url",
  ])("never treats an unrelated URL as owned: %s", (publicUrl) => {
    expect(locatePublicMediaObject({ ...common, publicUrl })).toBeNull();
  });
});


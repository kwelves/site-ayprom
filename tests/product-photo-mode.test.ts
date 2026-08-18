import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCT_PHOTO_MODE,
  isProductPhotoMode,
  usesScriptProcessing,
  usesWebpOutput,
} from "@/lib/admin/product-photo-mode";

describe("isProductPhotoMode", () => {
  it("accepts the four known modes", () => {
    expect(isProductPhotoMode("normal")).toBe(true);
    expect(isProductPhotoMode("webp")).toBe(true);
    expect(isProductPhotoMode("script")).toBe(true);
    expect(isProductPhotoMode("script-webp")).toBe(true);
  });

  it("rejects anything else, including empty/undefined", () => {
    expect(isProductPhotoMode("scripted")).toBe(false);
    expect(isProductPhotoMode("")).toBe(false);
    expect(isProductPhotoMode(undefined)).toBe(false);
    expect(isProductPhotoMode(null)).toBe(false);
  });

  it("defaults to normal", () => {
    expect(DEFAULT_PRODUCT_PHOTO_MODE).toBe("normal");
  });
});

describe("usesScriptProcessing", () => {
  it("is true only for the two script modes", () => {
    expect(usesScriptProcessing("script")).toBe(true);
    expect(usesScriptProcessing("script-webp")).toBe(true);
    expect(usesScriptProcessing("normal")).toBe(false);
    expect(usesScriptProcessing("webp")).toBe(false);
  });
});

describe("usesWebpOutput", () => {
  it("is true only for the two webp modes", () => {
    expect(usesWebpOutput("webp")).toBe(true);
    expect(usesWebpOutput("script-webp")).toBe(true);
    expect(usesWebpOutput("normal")).toBe(false);
    expect(usesWebpOutput("script")).toBe(false);
  });
});

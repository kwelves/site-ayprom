import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { convertBufferToWebp, enhanceProductPhotoBuffer } from "@/lib/admin/enhance-product-photo";

async function makeSamplePhoto(): Promise<Buffer> {
  // A transparent 400x500 canvas with an opaque 200x250 rectangle placed
  // off-center — enough for the alpha-bbox crop step to have real work to do.
  return sharp({
    create: { width: 400, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: { create: { width: 200, height: 250, channels: 4, background: { r: 30, g: 90, b: 200, alpha: 255 } } },
        top: 125,
        left: 100,
      },
    ])
    .png()
    .toBuffer();
}

describe("enhanceProductPhotoBuffer", () => {
  it("produces a square, opaque PNG at the default canvas size", async () => {
    const input = await makeSamplePhoto();
    const output = await enhanceProductPhotoBuffer(input);
    const meta = await sharp(output).metadata();

    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1600);
    expect(meta.hasAlpha).toBe(false);
  });
});

describe("convertBufferToWebp", () => {
  it("re-encodes a buffer to WebP", async () => {
    const input = await makeSamplePhoto();
    const output = await convertBufferToWebp(input);
    const meta = await sharp(output).metadata();

    expect(meta.format).toBe("webp");
  });

  it("re-encodes an already-enhanced PNG to WebP without changing dimensions", async () => {
    const input = await makeSamplePhoto();
    const enhanced = await enhanceProductPhotoBuffer(input);
    const output = await convertBufferToWebp(enhanced);
    const meta = await sharp(output).metadata();

    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(1600);
  });
});

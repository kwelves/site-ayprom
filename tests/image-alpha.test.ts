import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { hasAlphaChannel } from "@/lib/admin/image-validation";

async function toBytes(buffer: Buffer): Promise<Uint8Array> {
  return new Uint8Array(buffer);
}

describe("hasAlphaChannel", () => {
  it("JPEG is always reported as having no alpha", () => {
    expect(hasAlphaChannel(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(false);
  });

  it("detects an opaque PNG", async () => {
    const buffer = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    expect(hasAlphaChannel(await toBytes(buffer), "image/png")).toBe(false);
  });

  it("detects a PNG with an alpha channel", async () => {
    const buffer = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 0.5 } },
    })
      .png()
      .toBuffer();
    expect(hasAlphaChannel(await toBytes(buffer), "image/png")).toBe(true);
  });

  it("detects an opaque (lossy) WebP", async () => {
    const buffer = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 0, b: 0 } } })
      .webp()
      .toBuffer();
    expect(hasAlphaChannel(await toBytes(buffer), "image/webp")).toBe(false);
  });

  it("detects a lossy WebP with an alpha channel (VP8X)", async () => {
    const buffer = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 0.5 } },
    })
      .webp()
      .toBuffer();
    expect(hasAlphaChannel(await toBytes(buffer), "image/webp")).toBe(true);
  });

  it("detects a lossless WebP with an alpha channel (VP8L)", async () => {
    const buffer = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 0.5 } },
    })
      .webp({ lossless: true })
      .toBuffer();
    expect(hasAlphaChannel(await toBytes(buffer), "image/webp")).toBe(true);
  });

  it("returns null for AVIF (not attempted)", () => {
    expect(hasAlphaChannel(new Uint8Array(20), "image/avif")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { readRasterImageDimensions } from "@/lib/admin/image-validation";

function writeText(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

describe("readRasterImageDimensions", () => {
  it("reads PNG dimensions", () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 1920);
    view.setUint32(20, 1080);

    expect(readRasterImageDimensions(bytes, "image/png")).toEqual({ width: 1920, height: 1080 });
  });

  it("reads JPEG start-of-frame dimensions", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x04, 0x38, 0x07, 0x80]);

    expect(readRasterImageDimensions(bytes, "image/jpeg")).toEqual({ width: 1920, height: 1080 });
  });

  it("reads extended WebP dimensions", () => {
    const bytes = new Uint8Array(30);
    writeText(bytes, 0, "RIFF");
    writeText(bytes, 8, "WEBP");
    writeText(bytes, 12, "VP8X");
    const widthMinusOne = 853;
    const heightMinusOne = 479;
    bytes.set([widthMinusOne & 0xff, (widthMinusOne >> 8) & 0xff, (widthMinusOne >> 16) & 0xff], 24);
    bytes.set([heightMinusOne & 0xff, (heightMinusOne >> 8) & 0xff, (heightMinusOne >> 16) & 0xff], 27);

    expect(readRasterImageDimensions(bytes, "image/webp")).toEqual({ width: 854, height: 480 });
  });

  it("reads AVIF ispe dimensions", () => {
    const bytes = new Uint8Array(32);
    writeText(bytes, 4, "ftypavif");
    writeText(bytes, 12, "ispe");
    const view = new DataView(bytes.buffer);
    view.setUint32(20, 1600);
    view.setUint32(24, 900);

    expect(readRasterImageDimensions(bytes, "image/avif")).toEqual({ width: 1600, height: 900 });
  });
});

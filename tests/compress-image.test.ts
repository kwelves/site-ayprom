import { describe, expect, it } from "vitest";
import {
  MAX_SERVER_ACTION_FILE_BYTES,
  resolveCompressionOutputFormat,
  SERVER_ACTION_BODY_LIMIT_BYTES,
} from "@/lib/admin/compress-image";

describe("client image compression contract", () => {
  it("keeps a known alpha channel in an alpha-capable WebP output", () => {
    expect(resolveCompressionOutputFormat("image/png", true, "image/jpeg")).toBe("image/webp");
    expect(resolveCompressionOutputFormat("image/webp", true, "image/jpeg")).toBe("image/webp");
  });

  it("conservatively keeps formats whose alpha cannot be determined", () => {
    expect(resolveCompressionOutputFormat("image/avif", null, "image/jpeg")).toBe("image/webp");
    expect(resolveCompressionOutputFormat("image/webp", null, "image/jpeg")).toBe("image/webp");
  });

  it("allows opaque images to use the requested compact format", () => {
    expect(resolveCompressionOutputFormat("image/png", false, "image/jpeg")).toBe("image/jpeg");
    expect(resolveCompressionOutputFormat("image/jpeg", false)).toBe("image/jpeg");
  });

  it("reserves at least 512 KiB of the raw action body for multipart overhead", () => {
    expect(SERVER_ACTION_BODY_LIMIT_BYTES - MAX_SERVER_ACTION_FILE_BYTES).toBeGreaterThanOrEqual(512 * 1024);
  });
});

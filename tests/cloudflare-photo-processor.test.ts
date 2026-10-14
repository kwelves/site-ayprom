import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processProductPhoto } from "@/cloudflare/media/product-photo-processor.mjs";
import { enhanceProductPhotoBuffer, convertBufferToWebp } from "@/lib/admin/enhance-product-photo";
import { generateProductImageVariants } from "@/lib/admin/product-image-variants.core.mjs";
import { MAX_IMAGE_BYTES } from "@/lib/admin/image-validation";

const target = { productSlug: "gear-pump", imageId: "11111111-2222-4333-8444-555555555555" };
const hash = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
const photo = () => readFile(new URL("./e2e/fixtures/product-photo.jpg", import.meta.url));

describe("external Node photo processor", () => {
  it.each(["normal", "webp", "script", "script-webp"] as const)("preserves the existing %s master and both variant bytes", async (mode) => {
    // webp arrives already converted by the browser; it must not be recompressed.
    const input = mode === "webp" ? await convertBufferToWebp(await photo()) : await photo();
    const original = Buffer.from(input);
    let expected = input;
    if (mode === "script" || mode === "script-webp") expected = await enhanceProductPhotoBuffer(input);
    if (mode === "script-webp") expected = await convertBufferToWebp(expected);
    const variants = await generateProductImageVariants(expected, target);
    const result = await processProductPhoto({ ...target, mode, input, contentType: mode === "webp" ? "image/webp" : "image/jpeg" });
    expect(input).toEqual(original);
    expect(result.inputSha256).toBe(hash(input));
    expect(result.master.body.equals(expected)).toBe(true);
    expect(result.thumbnail.body.equals(variants.thumbnail.body)).toBe(true);
    expect(result.gallery.body.equals(variants.gallery.body)).toBe(true);
    expect(result.thumbnail.path).toBe(variants.thumbnail.path);
    expect(result.gallery.path).toBe(variants.gallery.path);
    const extension = mode === "normal" ? "jpg" : mode === "script" ? "png" : "webp";
    expect(result.master.path).toBe(`${target.productSlug}/${target.imageId}/master.${extension}`);
    for (const object of [result.master, result.thumbnail, result.gallery]) {
      expect(object.sha256).toBe(hash(object.body));
      expect(object.bytes).toBe(object.body.byteLength);
    }
    const repeat = await processProductPhoto({ ...target, mode, input, contentType: mode === "webp" ? "image/webp" : "image/jpeg" });
    expect(repeat.master.sha256).toBe(result.master.sha256);
    expect(repeat.thumbnail.sha256).toBe(result.thumbnail.sha256);
    expect(repeat.gallery.sha256).toBe(result.gallery.sha256);
  }, 30_000);

  it("preserves PNG alpha and applies JPEG EXIF in the variants exactly as before", async () => {
    const png = await sharp({ create: { width: 50, height: 70, channels: 4, background: { r: 30, g: 90, b: 180, alpha: 0.5 } } }).png().toBuffer();
    const pngResult = await processProductPhoto({ ...target, mode: "normal", input: png, contentType: "image/png" });
    expect(pngResult.master.body.equals(png)).toBe(true);
    expect((await sharp(pngResult.gallery.body).metadata()).hasAlpha).toBe(true);
    const jpeg = await sharp(await photo()).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const result = await processProductPhoto({ ...target, mode: "normal", input: jpeg, contentType: "image/jpeg" });
    const expected = await generateProductImageVariants(jpeg, target);
    expect(result.gallery.body.equals(expected.gallery.body)).toBe(true);
    expect(result.master.body.equals(jpeg)).toBe(true);
  });

  it("accepts a real AVIF without changing the master", async () => {
    const input = await sharp(await photo()).resize(100).avif().toBuffer();
    const result = await processProductPhoto({ ...target, mode: "normal", input, contentType: "image/avif" });
    expect(result.master.body.equals(input)).toBe(true);
    expect(result.master.path.endsWith("/master.avif")).toBe(true);
  });

  it.each([
    { productSlug: "../outside" }, { productSlug: "a/b" }, { productSlug: "a%2fb" },
    { productSlug: "a\\b" }, { productSlug: "" }, { imageId: "../secret" },
    { imageId: "" }, { mode: "unknown" }, { contentType: "image/svg+xml" },
  ])("rejects unsafe identity or unsupported input metadata: %j", async (invalid) => {
    await expect(processProductPhoto({ ...target, mode: "normal", input: await photo(), contentType: "image/jpeg", ...invalid }))
      .rejects.toMatchObject({ code: "photo_processing_failed", rule: "invalid_input" });
  });

  it("rejects bytes over the existing upload limit and an empty file", async () => {
    for (const input of [Buffer.alloc(MAX_IMAGE_BYTES + 1), Buffer.alloc(0)]) {
      await expect(processProductPhoto({ ...target, mode: "normal", input, contentType: "image/jpeg" }))
        .rejects.toMatchObject({ rule: "invalid_input" });
    }
  });

  it("rejects a mismatched MIME, truncated image, and HTML without returning input or decoder errors", async () => {
    const input = await photo();
    for (const body of [input, input.subarray(0, 50), Buffer.from("<svg>PRIVATE_TEST_SECRET</svg>")]) {
      try {
        await processProductPhoto({ ...target, mode: "script", input: body, contentType: "image/png" });
        expect.fail("invalid image accepted");
      } catch (error) {
        expect(error).toMatchObject({ code: "photo_processing_failed", rule: "invalid_image" });
        expect(String(error)).toBe("PhotoProcessingError: photo_processing_failed");
        expect(JSON.stringify(error)).not.toContain("PRIVATE_TEST_SECRET");
        expect((error as Error).cause).toBeUndefined();
      }
    }
  });

  it("checks the decoded dimensions before the enhancement stage", async () => {
    const input = await sharp({ create: { width: 8001, height: 1, channels: 3, background: "white" } }).png().toBuffer();
    await expect(processProductPhoto({ ...target, mode: "script", input, contentType: "image/png" }))
      .rejects.toMatchObject({ rule: "invalid_image" });
  });

  it("rejects an actual animated WebP before script can silently flatten it", async () => {
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAAAICRAEAOw==", "base64");
    // The two frames must differ; the WebP encoder otherwise folds them into
    // a single still image. Change the second GIF's pixel palette index 0→1.
    const lastImage = gif.lastIndexOf(Buffer.from([2, 2, 0x44, 1, 0]));
    expect(lastImage).toBeGreaterThan(0);
    gif[lastImage + 2] = 0x4c;
    expect((await sharp(gif, { animated: true }).metadata()).pages).toBe(2);
    const input = await sharp(gif, { animated: true }).webp().toBuffer();
    expect((await sharp(input).metadata()).pages).toBe(2);
    for (const mode of ["normal", "webp", "script", "script-webp"]) {
      await expect(processProductPhoto({ ...target, mode, input, contentType: "image/webp" }))
        .rejects.toMatchObject({ rule: "invalid_image" });
    }
  });

  it("fails closed on a truncated JPEG even when its header dimensions are valid", async () => {
    const input = (await photo()).subarray(0, 2000);
    expect((await sharp(input).metadata()).width).toBeGreaterThan(0);
    await expect(processProductPhoto({ ...target, mode: "normal", input, contentType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "photo_processing_failed" });
  });

  it("snapshots bytes and metadata before the first await", async () => {
    const input = await photo();
    const original = Buffer.from(input);
    const request = { ...target, mode: "normal", input, contentType: "image/jpeg" };
    const pending = processProductPhoto(request);
    input.fill(0);
    request.productSlug = "../../outside";
    request.mode = "script";
    const result = await pending;
    expect(result.master.body.equals(original)).toBe(true);
    expect(result.master.path.startsWith(`${target.productSlug}/`)).toBe(true);
    expect(result.mode).toBe("normal");
  });

  it("runs all modes in plain Node without a Next or Vitest loader", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ["scripts/cloudflare/media-processor-smoke.mjs"], {
      cwd: process.cwd(), windowsHide: true, timeout: 50_000, maxBuffer: 64 * 1024,
    });
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ ok: true, localOnly: true });
    expect(report.results.map((result: { mode: string }) => result.mode)).toEqual(["normal", "webp", "script", "script-webp"]);
    for (const result of report.results) {
      expect(result.objects).toHaveLength(3);
      expect(result.objects[1]).toMatchObject({ name: "thumbnail", width: 640, height: 480, format: "webp" });
      expect(result.objects[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  }, 60_000);
});

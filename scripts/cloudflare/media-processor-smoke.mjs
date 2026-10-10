// A real Node/Sharp run, with no Next server, DB, storage, env or writes.
// Uses only the committed test photo; emits hashes and dimensions, not bytes.
import { readFile } from "node:fs/promises";
import { processProductPhoto } from "../../src/cloudflare/media/product-photo-processor.mjs";
import { convertBufferToWebp } from "../../src/lib/admin/enhance-product-photo.ts";
import sharp from "sharp";

try {
  if (process.argv.length !== 2) throw new Error("unexpected_arguments");
  const input = await readFile(new URL("../../tests/e2e/fixtures/product-photo.jpg", import.meta.url));
  const results = [];
  for (const mode of ["normal", "webp", "script", "script-webp"]) {
    const result = await processProductPhoto({
      input: mode === "webp" ? await convertBufferToWebp(input) : input,
      contentType: mode === "webp" ? "image/webp" : "image/jpeg",
      mode, productSlug: "fixture-product", imageId: "11111111-2222-4333-8444-555555555555",
    });
    const objects = [];
    for (const name of ["master", "thumbnail", "gallery"]) {
      const object = result[name];
      const meta = await sharp(object.body).metadata();
      objects.push({ name, sha256: object.sha256, bytes: object.bytes, width: meta.width, height: meta.height, format: meta.format });
    }
    results.push({ mode, objects });
  }
  console.log(JSON.stringify({ ok: true, localOnly: true, results }));
} catch {
  console.error(JSON.stringify({ ok: false, code: "media_processor_smoke_failed" }));
  process.exitCode = 1;
}

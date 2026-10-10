import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { createR2MediaObjectStore } from "@/cloudflare/publication/r2-media-store";

// Fake S3 client only: no network, no credentials, no real bucket.
function client(handler: (command: unknown) => unknown) {
  const sent: unknown[] = [];
  return { sent, send: async (command: unknown) => { sent.push(command); return handler(command); } };
}
const notFound = Object.assign(new Error("private-detail"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
const preconditionFailed = Object.assign(new Error("private-detail"), { $metadata: { httpStatusCode: 412 } });

describe("R2 media object store adapter", () => {
  it("reads size and recorded hash with a head request", async () => {
    const c = client(() => ({ ContentLength: 12, Metadata: { sha256: "a".repeat(64) } }));
    const store = createR2MediaObjectStore({ client: c, bucketName: "media" });
    expect(await store.head("product-images/immutable/x.webp")).toEqual({ size: 12, sha256: "a".repeat(64) });
    expect(c.sent[0]).toBeInstanceOf(HeadObjectCommand);
    expect((c.sent[0] as HeadObjectCommand).input).toEqual({ Bucket: "media", Key: "product-images/immutable/x.webp" });
  });

  it("answers null only for a genuine not-found and rethrows other failures as a fixed error", async () => {
    expect(await createR2MediaObjectStore({ client: client(() => { throw notFound; }), bucketName: "media" }).head("k/a")).toBeNull();
    const failing = createR2MediaObjectStore({ client: client(() => { throw Object.assign(new Error("private-detail"), { name: "AccessDenied" }); }), bucketName: "media" });
    const error = await failing.head("k/a").catch((e: unknown) => e as Error);
    expect((error as Error).message).toBe("media_store_unavailable");
    expect(JSON.stringify(error)).not.toContain("private-detail");
  });

  it("writes only if absent, with immutable caching, and reports a lost race as exists", async () => {
    const c = client(() => ({}));
    const store = createR2MediaObjectStore({ client: c, bucketName: "media" });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await store.putIfAbsent({ key: "product-images/immutable/x.webp", bytes, contentType: "image/webp", sha256: "b".repeat(64) })).toBe("created");
    const put = c.sent[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({ Bucket: "media", Key: "product-images/immutable/x.webp", ContentType: "image/webp",
      ContentLength: 3, IfNoneMatch: "*", Metadata: { sha256: "b".repeat(64) },
      CacheControl: "public, max-age=31536000, immutable" });
    const racing = createR2MediaObjectStore({ client: client(() => { throw preconditionFailed; }), bucketName: "media" });
    expect(await racing.putIfAbsent({ key: "k/a", bytes, contentType: "image/webp", sha256: "b".repeat(64) })).toBe("exists");
  });

  it("exposes no delete or overwrite and rejects bad construction", () => {
    const store = createR2MediaObjectStore({ client: client(() => ({})), bucketName: "media" });
    expect(Object.keys(store).sort()).toEqual(["head", "putIfAbsent"]);
    expect(() => createR2MediaObjectStore({ client: client(() => ({})), bucketName: "" })).toThrow("media_store_unavailable");
    expect(() => createR2MediaObjectStore({ client: null as never, bucketName: "media" })).toThrow("media_store_unavailable");
  });
});

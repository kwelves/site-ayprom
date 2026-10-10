import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  collectReleaseMediaKeys,
  stageMedia,
  verifyReleaseMedia,
  type MediaObjectStore,
} from "@/cloudflare/publication/media-release";
import { buildR2PublicUrl, locatePublicMediaObject } from "@/lib/media-storage-core";

// Local in-memory object store only. No R2, S3 client or network is used here.
const BASE = "https://media.example.test";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fakeStore(initial: Record<string, { bytes: Uint8Array; sha256?: string | null }> = {}) {
  const objects = new Map(Object.entries(initial).map(([key, value]) =>
    [key, { size: value.bytes.byteLength, sha256: value.sha256 === undefined ? sha(value.bytes) : value.sha256 }]));
  const operations: string[] = [];
  const store: MediaObjectStore = {
    async head(key) { operations.push("head:" + key); return objects.get(key) ?? null; },
    async putIfAbsent({ key, bytes, sha256 }) {
      operations.push("put:" + key);
      if (objects.has(key)) return "exists";
      objects.set(key, { size: bytes.byteLength, sha256 });
      return "created";
    },
  };
  return { store, objects, operations };
}
const bytes = (text: string) => new TextEncoder().encode(text);

describe("immutable R2 media staging", () => {
  it("stages new bytes under a content-addressed key with a public URL that round-trips", async () => {
    const f = fakeStore();
    const data = bytes("photo-one");
    const staged = await stageMedia({ store: f.store, bucket: "product-images", bytes: data,
      contentType: "image/webp", publicBaseUrl: BASE });
    expect(staged.sha256).toBe(sha(data));
    expect(staged.immutableKey).toBe(`product-images/immutable/${sha(data)}.webp`);
    expect(staged.publicUrl).toBe(buildR2PublicUrl(BASE, "product-images", `immutable/${sha(data)}.webp`));
    expect(locatePublicMediaObject({ publicUrl: staged.publicUrl, bucket: "product-images",
      supabaseUrl: "https://db.example.test", r2PublicBaseUrl: BASE })?.key).toBe(staged.immutableKey);
    expect(f.objects.has(staged.immutableKey)).toBe(true);
  });

  it("does not write duplicate content twice and gives the same key", async () => {
    const f = fakeStore();
    const input = { store: f.store, bucket: "product-images" as const, bytes: bytes("same"),
      contentType: "image/png", publicBaseUrl: BASE };
    const first = await stageMedia(input);
    const second = await stageMedia(input);
    expect(second).toEqual(first);
    expect(f.operations.filter((op) => op.startsWith("put:"))).toHaveLength(1);
  });

  it("gives changed bytes a new key and leaves the old object untouched", async () => {
    const f = fakeStore();
    const old = await stageMedia({ store: f.store, bucket: "product-images", bytes: bytes("v1"),
      contentType: "image/webp", publicBaseUrl: BASE });
    const next = await stageMedia({ store: f.store, bucket: "product-images", bytes: bytes("v2"),
      contentType: "image/webp", publicBaseUrl: BASE });
    expect(next.immutableKey).not.toBe(old.immutableKey);
    expect(f.objects.get(old.immutableKey)?.sha256).toBe(sha(bytes("v1")));
    expect(f.objects.size).toBe(2);
  });

  it("refuses to overwrite a different object found at the key, before or during the write", async () => {
    const data = bytes("expected");
    const key = `product-images/immutable/${sha(data)}.webp`;
    const corrupted = fakeStore({ [key]: { bytes: bytes("someone else"), sha256: "f".repeat(64) } });
    await expect(stageMedia({ store: corrupted.store, bucket: "product-images", bytes: data,
      contentType: "image/webp", publicBaseUrl: BASE })).rejects.toThrow("media_conflict");
    expect(corrupted.operations.some((op) => op.startsWith("put:"))).toBe(false);
    // A concurrent writer appears between head and put.
    let first = true;
    const racing: MediaObjectStore = {
      async head() { if (first) { first = false; return null; } return { size: 3, sha256: "e".repeat(64) }; },
      async putIfAbsent() { return "exists"; },
    };
    await expect(stageMedia({ store: racing, bucket: "product-images", bytes: data,
      contentType: "image/webp", publicBaseUrl: BASE })).rejects.toThrow("media_conflict");
  });

  it("offers no way to delete or replace: only head and put-if-absent are ever used", async () => {
    const f = fakeStore();
    await stageMedia({ store: f.store, bucket: "brand-logos", bytes: bytes("logo"),
      contentType: "image/svg+xml", publicBaseUrl: BASE });
    expect(f.operations.every((op) => /^(head|put):/.test(op))).toBe(true);
    expect(Object.keys(f.store).sort()).toEqual(["head", "putIfAbsent"]);
  });

  it.each([
    ["empty bytes", new Uint8Array(0), "image/webp", "product-images"],
    ["unsupported type", bytes("x"), "text/html", "product-images"],
    ["unknown bucket", bytes("x"), "image/webp", "private-bucket"],
    ["too large", new Uint8Array(26 * 1024 * 1024), "image/webp", "product-images"],
  ])("rejects %s without touching the store", async (_name, data, contentType, bucket) => {
    const f = fakeStore();
    await expect(stageMedia({ store: f.store, bucket: bucket as "product-images", bytes: data as Uint8Array,
      contentType, publicBaseUrl: BASE })).rejects.toThrow("media_invalid");
    expect(f.operations).toEqual([]);
  });
});

describe("release media verification", () => {
  const documents = {
    product: [{ slug: "p1", images: [{ url: `${BASE}/product-images/a.webp`, fallbackUrl: `${BASE}/product-images/a.jpg` },
      { url: "https://other.example.test/product-images/not-ours.webp" }] }],
    category: [{ slug: "c1", image: `${BASE}/category-images/c%20one.webp` }],
    brand: [{ slug: "b1", logo: `${BASE}/brand-logos/b.svg` }],
    note: "not media: https://media.example.test/missing-bucket/x.webp",
  };

  it("collects only configured R2 media keys, deduplicated and decoded", () => {
    expect(collectReleaseMediaKeys(documents, { publicBaseUrl: BASE })).toEqual([
      "brand-logos/b.svg", "category-images/c one.webp", "product-images/a.jpg", "product-images/a.webp"]);
  });

  it("reports ok when every referenced object exists and names the missing ones otherwise", async () => {
    const present = { "brand-logos/b.svg": { bytes: bytes("1") }, "category-images/c one.webp": { bytes: bytes("2") },
      "product-images/a.jpg": { bytes: bytes("3") }, "product-images/a.webp": { bytes: bytes("4") } };
    const all = fakeStore(present);
    const references = { list: async () => collectReleaseMediaKeys(documents, { publicBaseUrl: BASE }) };
    expect(await verifyReleaseMedia({ releaseId: "r1", references, store: all.store })).toEqual({ ok: true, missing: [] });
    const partial = fakeStore(Object.fromEntries(Object.entries(present).filter(([key]) => key !== "product-images/a.webp")));
    expect(await verifyReleaseMedia({ releaseId: "r1", references, store: partial.store }))
      .toEqual({ ok: false, missing: ["product-images/a.webp"] });
    expect(partial.operations.every((op) => op.startsWith("head:"))).toBe(true);
  });

  it("treats an immutable object whose recorded hash does not match its name as missing", async () => {
    const good = bytes("good");
    const goodKey = `product-images/immutable/${sha(good)}.webp`;
    const badKey = `product-images/immutable/${sha(bytes("other"))}.webp`;
    const f = fakeStore({ [goodKey]: { bytes: good }, [badKey]: { bytes: bytes("tampered"), sha256: "0".repeat(64) } });
    expect(await verifyReleaseMedia({ releaseId: "r", store: f.store,
      references: { list: async () => [goodKey, badKey] } })).toEqual({ ok: false, missing: [badKey] });
  });

  it("fails closed when the reference list or store is unavailable", async () => {
    const f = fakeStore();
    await expect(verifyReleaseMedia({ releaseId: "r", store: f.store,
      references: { list: async () => { throw new Error("private-token"); } } })).resolves.toEqual({ ok: false, missing: [] });
    const broken: MediaObjectStore = { head: async () => { throw new Error("private-token"); }, putIfAbsent: async () => "created" };
    const result = await verifyReleaseMedia({ releaseId: "r", store: broken,
      references: { list: async () => ["product-images/a.webp"] } });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-token");
  });
});

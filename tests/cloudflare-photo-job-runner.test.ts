import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runClaimedPhotoJob } from "@/cloudflare/media/product-photo-job-runner.mjs";

const ID = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const TOKEN = "44444444-4444-4444-8444-444444444444";
const SOURCE_KEY = `product-image-staging/${DRAFT}/${ID}/source.jpg`;
const BASE = "https://media.example.invalid";
const digest = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
const source = () => readFile(new URL("./e2e/fixtures/product-photo.jpg", import.meta.url));

function claimedJob(body: Uint8Array) {
  return {
    id: ID, draft_id: DRAFT, state: "processing", lease_token: TOKEN,
    source_key: SOURCE_KEY, source_sha256: digest(body), byte_size: body.byteLength,
    content_type: "image/jpeg", mode: "normal", product_slug: "test-product",
  };
}

function memoryPorts(body: Uint8Array) {
  const objects = new Map<string, { body: Uint8Array; bytes: number; sha256: string; contentType: string }>();
  let published: unknown = null;
  const failures: unknown[] = [];
  let writes = 0;
  const storage = {
    readSource: async (key: string) => {
      if (key !== SOURCE_KEY) throw new Error("wrong_source");
      return body;
    },
    putIfAbsent: async (key: string, data: { body: Uint8Array; contentType: string; sha256: string }) => {
      if (objects.has(key)) return false;
      writes++;
      objects.set(key, { body: Buffer.from(data.body), bytes: data.body.byteLength, sha256: digest(data.body), contentType: data.contentType });
      return true;
    },
    head: async (key: string) => {
      const object = objects.get(key);
      return object && { bytes: object.bytes, sha256: object.sha256, contentType: object.contentType };
    },
  };
  const jobs = {
    finish: async (value: { receipt: Record<string, { path: string; sha256: string; bytes: number; contentType: string }> }) => {
      for (const kind of ["master", "thumbnail", "gallery"]) {
        const item = value.receipt[kind];
        const saved = objects.get(`product-images/${item.path}`);
        if (!saved || saved.sha256 !== item.sha256 || saved.bytes !== item.bytes || saved.contentType !== item.contentType) {
          throw new Error("unverified_object");
        }
      }
      published = value;
      return ID;
    },
    fail: async (value: unknown) => { failures.push(value); },
  };
  return { storage, jobs, objects, failures, get published() { return published; }, get writes() { return writes; } };
}

describe("claimed product photo job", () => {
  it("publishes only after all three real Sharp objects are saved and verified", async () => {
    const body = await source();
    const ports = memoryPorts(body);
    const result = await runClaimedPhotoJob({ job: claimedJob(body), ...ports, publicBase: BASE });

    expect(result).toBe(ID);
    expect(ports.published).toMatchObject({ id: ID, token: TOKEN, publicBase: BASE });
    expect(ports.objects.size).toBe(3);
    expect(ports.objects.has(`product-images/test-product/${ID}/master.jpg`)).toBe(true);
    expect(ports.failures).toEqual([]);
    expect(ports.writes).toBe(3);
  });

  it("reuses byte-identical final objects on a retry without overwriting them", async () => {
    const body = await source();
    const ports = memoryPorts(body);
    await runClaimedPhotoJob({ job: claimedJob(body), ...ports, publicBase: BASE });
    const firstMaster = ports.objects.get(`product-images/test-product/${ID}/master.jpg`)?.body;
    await runClaimedPhotoJob({ job: claimedJob(body), ...ports, publicBase: BASE });

    expect(ports.writes).toBe(3);
    expect(ports.objects.get(`product-images/test-product/${ID}/master.jpg`)?.body).toBe(firstMaster);
    expect(ports.failures).toEqual([]);
  });

  it("does not publish a staged file whose bytes differ from the queued hash", async () => {
    const body = await source();
    const ports = memoryPorts(Buffer.from("not the reserved image"));
    await expect(runClaimedPhotoJob({ job: claimedJob(body), ...ports, publicBase: BASE })).rejects.toMatchObject({ code: "photo_job_failed", rule: "source_mismatch" });
    expect(ports.objects.size).toBe(0);
    expect(ports.published).toBeNull();
    expect(ports.failures).toEqual([{ id: ID, token: TOKEN, retry: true }]);
  });

  it("refuses to publish when the stored copy cannot be verified after upload", async () => {
    const body = await source();
    const ports = memoryPorts(body);
    ports.storage.head = async () => undefined;
    await expect(runClaimedPhotoJob({ job: claimedJob(body), ...ports, publicBase: BASE })).rejects.toMatchObject({ code: "photo_job_failed", rule: "object_unverified" });
    expect(ports.published).toBeNull();
    expect(ports.failures).toEqual([{ id: ID, token: TOKEN, retry: true }]);
  });

  it("rejects a forged source key before reading storage or touching the job", async () => {
    const body = await source();
    const ports = memoryPorts(body);
    await expect(runClaimedPhotoJob({ job: { ...claimedJob(body), source_key: "../other" }, ...ports, publicBase: BASE }))
      .rejects.toMatchObject({ code: "photo_job_failed", rule: "invalid_job" });
    expect(ports.objects.size).toBe(0);
    expect(ports.published).toBeNull();
    expect(ports.failures).toEqual([]);
  });
});

describe("one-job photo processor entry", () => {
  it("does not claim a job when the storage configuration is invalid", async () => {
    const { runNextPhotoJob } = await import("@/cloudflare/media/product-photo-job-runner.mjs");
    expect(runNextPhotoJob).toBeTypeOf("function");
    let claims = 0;
    const jobs = { claim: async () => { claims++; return null; }, finish: async () => ID, fail: async () => null };
    await expect(runNextPhotoJob({ jobs, storage: {}, publicBase: BASE })).rejects.toMatchObject({ code: "photo_job_failed" });
    expect(claims).toBe(0);
  });

  it("returns null for an empty queue without reading source storage", async () => {
    const { runNextPhotoJob } = await import("@/cloudflare/media/product-photo-job-runner.mjs");
    expect(runNextPhotoJob).toBeTypeOf("function");
    let reads = 0;
    let seconds = 0;
    const storage = { readSource: async () => { reads++; return Buffer.from("unused"); }, putIfAbsent: async () => true,
      head: async () => null };
    const jobs = { claim: async (requested: number) => { seconds = requested; return null; }, finish: async () => ID, fail: async () => null };
    expect(await runNextPhotoJob({ jobs, storage, publicBase: BASE })).toBeNull();
    expect(seconds).toBe(300);
    expect(reads).toBe(0);
  });

  it("claims and processes one job before returning its id", async () => {
    const { runNextPhotoJob } = await import("@/cloudflare/media/product-photo-job-runner.mjs");
    expect(runNextPhotoJob).toBeTypeOf("function");
    const body = await source();
    const ports = memoryPorts(body);
    let claims = 0;
    const jobs = { ...ports.jobs, claim: async (seconds: number) => { claims++; expect(seconds).toBe(300); return claimedJob(body); } };
    expect(await runNextPhotoJob({ jobs, storage: ports.storage, publicBase: BASE })).toBe(ID);
    expect(claims).toBe(1);
    expect(ports.published).toMatchObject({ id: ID });
    expect(ports.writes).toBe(3);
  });

  it("does not expose a private backend error if claiming fails", async () => {
    const { runNextPhotoJob } = await import("@/cloudflare/media/product-photo-job-runner.mjs");
    expect(runNextPhotoJob).toBeTypeOf("function");
    const storage = { readSource: async () => Buffer.from("unused"), putIfAbsent: async () => true, head: async () => null };
    const jobs = { claim: async () => { throw new Error("private key detail"); }, finish: async () => ID, fail: async () => null };
    let error: unknown;
    try { await runNextPhotoJob({ jobs, storage, publicBase: BASE }); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: "photo_job_failed", rule: "claim_failed" });
    expect(String(error)).not.toContain("private key detail");
  });
});

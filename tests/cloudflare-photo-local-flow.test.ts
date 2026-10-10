import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it } from "vitest";
import { createMediaJobPorts } from "@/cloudflare/media/photo-job-ports.mjs";
import { createR2PhotoStorage } from "@/cloudflare/media/photo-r2-storage.mjs";
import { runNextPhotoJob } from "@/cloudflare/media/product-photo-job-runner.mjs";

const ID = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const TOKEN = "44444444-4444-4444-8444-444444444444";
const SOURCE = `product-image-staging/${DRAFT}/${ID}/source.jpg`;
const BASE = "https://media.example.invalid";
const KEY = "sb_secret_fixture_only";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type ObjectData = { body: Buffer; contentType: string; sha256: string };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

async function localFlow(sourceBody: Buffer, storedBody = sourceBody, corruptPublicHead = false) {
  const objects = new Map<string, ObjectData>([[`private-staging/${SOURCE}`,
    { body: storedBody, contentType: "image/jpeg", sha256: hash(storedBody) }]]);
  const s3Requests: string[] = [];
  const s3Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const [bucket, ...parts] = new URL(request.url ?? "/", "http://localhost").pathname.slice(1).split("/");
    const key = decodeURIComponent(parts.join("/"));
    const path = `${bucket}/${key}`;
    s3Requests.push(`${request.method} ${path}`);
    if (!["private-staging", "public-media"].includes(bucket)) { response.writeHead(404).end(); return; }
    if (request.method === "PUT") {
      if (bucket !== "public-media" || request.headers["if-none-match"] !== "*") { response.writeHead(403).end(); return; }
      if (objects.has(path)) { response.writeHead(412).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      objects.set(path, { body, contentType: String(request.headers["content-type"]), sha256: String(request.headers["x-amz-meta-sha256"]) });
      response.writeHead(200, { etag: '"fixture"' }).end();
      return;
    }
    const object = objects.get(path);
    if (!object) { response.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code></Error>"); return; }
    const headers = { "content-length": object.body.length, "content-type": object.contentType,
      "x-amz-meta-sha256": corruptPublicHead && bucket === "public-media" ? "0".repeat(64) : object.sha256,
      etag: '"fixture"' };
    if (request.method === "HEAD") { response.writeHead(200, headers).end(); return; }
    if (request.method === "GET") { response.writeHead(200, headers).end(object.body); return; }
    response.writeHead(405).end();
  });
  s3Server.listen(0, "127.0.0.1");
  await once(s3Server, "listening");
  const s3Address = s3Server.address();
  if (!s3Address || typeof s3Address === "string") throw new Error("fixture_listen_failed");
  const client = new S3Client({ endpoint: `http://127.0.0.1:${s3Address.port}`, region: "auto", forcePathStyle: true,
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" }, maxAttempts: 1 });
  cleanup.push(async () => { client.destroy(); await new Promise<void>((resolve) => s3Server.close(() => resolve())); });

  const job = {
    id: ID, draft_id: DRAFT, owner_hash: "b".repeat(64), mode: "normal", content_type: "image/jpeg", byte_size: sourceBody.length,
    source_key: SOURCE, source_sha256: hash(sourceBody), product_id: "55555555-5555-4555-8555-555555555555",
    product_slug: "test-product", image_order: 0, state: "ready", attempts: 0, lease_token: null as string | null,
    lease_until: null as string | null, receipt: null, public_base: null, created_at: "2026-10-03T15:00:00Z", expires_at: "2026-10-04T15:00:00Z",
  };
  const dbRequests: string[] = [];
  let published = false;
  const dbServer = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? "";
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    dbRequests.push(path);
    if (request.headers.apikey !== KEY || request.headers.authorization) { response.writeHead(403).end("{}"); return; }
    if (path.endsWith("/claim_product_media_job")) {
      if (job.state !== "ready") { response.writeHead(200, { "content-type": "application/json" }).end("[]"); return; }
      job.state = "processing"; job.attempts++; job.lease_token = TOKEN; job.lease_until = "2026-10-03T16:00:00Z";
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([job]));
      return;
    }
    if (input.p_id !== ID || input.p_token !== TOKEN || job.state !== "processing") { response.writeHead(409).end("{}"); return; }
    if (path.endsWith("/finish_product_media_job")) {
      const receipt = input.p_receipt as Record<string, unknown>;
      const verified = receipt.inputSha256 === job.source_sha256 && input.p_base === BASE
        && ["master", "thumbnail", "gallery"].every((kind) => {
          const item = receipt[kind] as { path: string; sha256: string; bytes: number; contentType: string } | undefined;
          const saved = objects.get(`public-media/product-images/${item?.path}`);
          return item && saved && saved.sha256 === item.sha256 && saved.body.length === item.bytes && saved.contentType === item.contentType;
        });
      if (!verified) { response.writeHead(409).end("{}"); return; }
      published = true; job.state = "succeeded";
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(ID));
      return;
    }
    if (path.endsWith("/fail_product_media_job")) {
      job.state = "ready"; job.lease_token = null; job.lease_until = null;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(job));
      return;
    }
    response.writeHead(404).end("{}");
  });
  dbServer.listen(0, "127.0.0.1");
  await once(dbServer, "listening");
  const dbAddress = dbServer.address();
  if (!dbAddress || typeof dbAddress === "string") throw new Error("fixture_listen_failed");
  cleanup.push(() => new Promise<void>((resolve) => dbServer.close(() => resolve())));

  const jobs = createMediaJobPorts({ SUPABASE_URL: `http://127.0.0.1:${dbAddress.port}`, MEDIA_SUPABASE_KEY: KEY });
  const storage = createR2PhotoStorage({ client, stagingBucket: "private-staging", publicBucket: "public-media" });
  return { jobs, storage, objects, dbRequests, s3Requests, get published() { return published; } };
}

describe("local photo pipeline with real Sharp, fetch and S3 client", () => {
  it("publishes only after the three public objects have been written and verified", async () => {
    const source = await readFile(new URL("./e2e/fixtures/product-photo.jpg", import.meta.url));
    const flow = await localFlow(source);
    expect(await runNextPhotoJob({ storage: flow.storage, jobs: flow.jobs, publicBase: BASE })).toBe(ID);
    expect(flow.published).toBe(true);
    expect([...flow.objects.keys()].filter((key) => key.startsWith("public-media/"))).toHaveLength(3);
    expect(flow.dbRequests).toEqual([
      "/rest/v1/rpc/claim_product_media_job", "/rest/v1/rpc/finish_product_media_job",
    ]);
    expect(flow.s3Requests.filter((request) => request.startsWith("PUT public-media/"))).toHaveLength(3);
    expect(flow.s3Requests.some((request) => request.startsWith("PUT private-staging/"))).toBe(false);
    expect(await runNextPhotoJob({ storage: flow.storage, jobs: flow.jobs, publicBase: BASE })).toBeNull();
  });

  it("does not publish and returns the lease to ready when the staged bytes are wrong", async () => {
    const source = await readFile(new URL("./e2e/fixtures/product-photo.jpg", import.meta.url));
    const flow = await localFlow(source, Buffer.from("damaged source"));
    await expect(runNextPhotoJob({ storage: flow.storage, jobs: flow.jobs, publicBase: BASE }))
      .rejects.toMatchObject({ code: "photo_job_failed", rule: "source_mismatch" });
    expect(flow.published).toBe(false);
    expect([...flow.objects.keys()].filter((key) => key.startsWith("public-media/"))).toHaveLength(0);
    expect(flow.dbRequests).toEqual([
      "/rest/v1/rpc/claim_product_media_job", "/rest/v1/rpc/fail_product_media_job",
    ]);
  });

  it("does not confirm the database job when public storage HEAD disagrees with saved bytes", async () => {
    const source = await readFile(new URL("./e2e/fixtures/product-photo.jpg", import.meta.url));
    const flow = await localFlow(source, source, true);
    await expect(runNextPhotoJob({ storage: flow.storage, jobs: flow.jobs, publicBase: BASE }))
      .rejects.toMatchObject({ code: "photo_job_failed", rule: "object_unverified" });
    expect(flow.published).toBe(false);
    expect(flow.dbRequests).toEqual([
      "/rest/v1/rpc/claim_product_media_job", "/rest/v1/rpc/fail_product_media_job",
    ]);
  });
});

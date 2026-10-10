import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it } from "vitest";
import { createR2PhotoStorage } from "@/cloudflare/media/photo-r2-storage.mjs";

const STAGING_BUCKET = "private-staging";
const PUBLIC_BUCKET = "public-media";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const ID = "22222222-2222-4222-8222-222222222222";
const SOURCE = `product-image-staging/${DRAFT}/${ID}/source.jpg`;
const FINAL = `product-images/test-product/${ID}/master.jpg`;
const digest = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
type ObjectData = { body: Buffer; contentType: string; sha256: string };

async function startS3Fixture(initial: Record<string, ObjectData> = {}) {
  const objects = new Map<string, ObjectData>(Object.entries(initial));
  const requests: string[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const [bucket, ...segments] = pathname.slice(1).split("/");
    const key = decodeURIComponent(segments.join("/"));
    requests.push(`${request.method} ${bucket}/${key}`);
    if (bucket !== STAGING_BUCKET && bucket !== PUBLIC_BUCKET) { response.writeHead(404).end(); return; }
    const objectKey = `${bucket}/${key}`;
    if (request.method === "PUT") {
      if (request.headers["if-none-match"] !== "*") { response.writeHead(400).end(); return; }
      if (objects.has(objectKey)) { response.writeHead(412).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      objects.set(objectKey, { body, contentType: String(request.headers["content-type"]), sha256: String(request.headers["x-amz-meta-sha256"]) });
      response.writeHead(200, { etag: '"test"' }).end();
      return;
    }
    const object = objects.get(objectKey);
    if (!object) { response.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code></Error>"); return; }
    const headers = { "content-length": object.body.length, "content-type": object.contentType, "x-amz-meta-sha256": object.sha256, etag: '"test"' };
    if (request.method === "HEAD") { response.writeHead(200, headers).end(); return; }
    if (request.method === "GET") { response.writeHead(200, headers).end(object.body); return; }
    response.writeHead(405).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture_listen_failed");
  const client = new S3Client({ endpoint: `http://127.0.0.1:${address.port}`, region: "auto", forcePathStyle: true,
    credentials: { accessKeyId: "local", secretAccessKey: "local" }, maxAttempts: 1 });
  return { client, objects, requests, close: async () => { client.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}

const open: Array<() => Promise<void>> = [];
afterEach(async () => { while (open.length) await open.pop()?.(); });

describe("private R2 photo storage adapter", () => {
  it("reads staged bytes and conditionally saves a final object without overwriting it", async () => {
    const source = Buffer.from("staged sample");
    const fixture = await startS3Fixture({ [`${STAGING_BUCKET}/${SOURCE}`]: { body: source, contentType: "image/jpeg", sha256: digest(source) } });
    open.push(fixture.close);
    const storage = createR2PhotoStorage({ client: fixture.client, stagingBucket: STAGING_BUCKET, publicBucket: PUBLIC_BUCKET });

    expect(Buffer.from(await storage.readSource(SOURCE))).toEqual(source);
    const first = Buffer.from("master one");
    expect(await storage.putIfAbsent(FINAL, { body: first, contentType: "image/jpeg", sha256: digest(first) })).toBe(true);
    expect(await storage.head(FINAL)).toEqual({ bytes: first.length, sha256: digest(first), contentType: "image/jpeg" });
    const other = Buffer.from("master two");
    expect(await storage.putIfAbsent(FINAL, { body: other, contentType: "image/jpeg", sha256: digest(other) })).toBe(false);
    expect(fixture.objects.get(`${PUBLIC_BUCKET}/${FINAL}`)?.body).toEqual(first);
    expect(fixture.requests).toContain(`GET ${STAGING_BUCKET}/${SOURCE}`);
    expect(fixture.requests).toContain(`PUT ${PUBLIC_BUCKET}/${FINAL}`);
    expect(fixture.requests).not.toContain(`PUT ${STAGING_BUCKET}/${FINAL}`);
  });

  it("rejects a forged key before making any network request", async () => {
    const fixture = await startS3Fixture();
    open.push(fixture.close);
    const storage = createR2PhotoStorage({ client: fixture.client, stagingBucket: STAGING_BUCKET, publicBucket: PUBLIC_BUCKET });

    await expect(storage.readSource("../private/other")).rejects.toMatchObject({ code: "photo_storage_failed", rule: "invalid_key" });
    await expect(storage.putIfAbsent("product-images/../other", { body: Buffer.from("x"), contentType: "image/jpeg", sha256: digest(Buffer.from("x")) }))
      .rejects.toMatchObject({ code: "photo_storage_failed", rule: "invalid_key" });
    expect(fixture.requests).toEqual([]);
  });

  it("refuses to read a staged object larger than eight MiB", async () => {
    const huge = Buffer.alloc(8 * 1024 * 1024 + 1);
    const fixture = await startS3Fixture({ [`${STAGING_BUCKET}/${SOURCE}`]: { body: huge, contentType: "image/jpeg", sha256: digest(huge) } });
    open.push(fixture.close);
    const storage = createR2PhotoStorage({ client: fixture.client, stagingBucket: STAGING_BUCKET, publicBucket: PUBLIC_BUCKET });

    await expect(storage.readSource(SOURCE)).rejects.toMatchObject({ code: "photo_storage_failed", rule: "source_too_large" });
  });

  it("refuses to use the public media bucket for private staging", async () => {
    const fixture = await startS3Fixture();
    open.push(fixture.close);
    expect(() => createR2PhotoStorage({ client: fixture.client, stagingBucket: PUBLIC_BUCKET, publicBucket: PUBLIC_BUCKET }))
      .toThrowError(expect.objectContaining({ code: "photo_storage_failed", rule: "invalid_configuration" }));
    expect(fixture.requests).toEqual([]);
  });
});

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createMediaJobPorts } from "@/cloudflare/media/photo-job-ports.mjs";

const ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "44444444-4444-4444-8444-444444444444";
const SHA = "a".repeat(64);
const SECRET = "sb_secret_local_only";
const job = {
  id: ID, draft_id: "33333333-3333-4333-8333-333333333333", owner_hash: "b".repeat(64),
  mode: "normal", content_type: "image/jpeg", byte_size: 120,
  source_key: `product-image-staging/33333333-3333-4333-8333-333333333333/${ID}/source.jpg`, source_sha256: SHA,
  product_id: "55555555-5555-4555-8555-555555555555", product_slug: "sample-part", image_order: 0,
  state: "processing", attempts: 1, lease_token: TOKEN, lease_until: "2026-10-03T16:00:00Z",
  receipt: null, public_base: null, created_at: "2026-10-03T15:00:00Z", expires_at: "2026-10-04T15:00:00Z",
};
type Seen = { path: string; method: string; apikey: string | undefined; authorization: string | undefined; body: unknown };

async function fixture(reply: (path: string, response: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    let text = "";
    for await (const chunk of request) text += chunk.toString();
    seen.push({ path: request.url ?? "", method: request.method ?? "", apikey: request.headers.apikey as string | undefined,
      authorization: request.headers.authorization, body: text ? JSON.parse(text) : null });
    reply(request.url ?? "", response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture_listen_failed");
  return { url: `http://127.0.0.1:${address.port}`, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

describe("private media-job RPC ports", () => {
  it("claims one job and finishes it with a body-free receipt using only a server key", async () => {
    const backend = await fixture((path, response) => {
      const value = path.endsWith("/claim_product_media_job") ? [job]
        : path.endsWith("/finish_product_media_job") ? ID : { ...job, state: "ready", lease_token: null, lease_until: null };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
    });
    cleanup.push(backend.close);
    const ports = createMediaJobPorts({ SUPABASE_URL: backend.url, MEDIA_SUPABASE_KEY: SECRET });
    const claimed = await ports.claim(300);
    const receipt = {
      inputSha256: SHA,
      master: { path: `sample-part/${ID}/master.jpg`, bytes: 120, sha256: SHA, contentType: "image/jpeg" },
      thumbnail: { path: `sample-part/${ID}/variants/v2/thumbnail-${"b".repeat(16)}.webp`, bytes: 80, sha256: "b".repeat(64), contentType: "image/webp" },
      gallery: { path: `sample-part/${ID}/variants/v1/gallery-${"c".repeat(16)}.webp`, bytes: 90, sha256: "c".repeat(64), contentType: "image/webp" },
    };
    expect(claimed).toEqual(job);
    expect(await ports.finish({ id: ID, token: TOKEN, receipt, publicBase: "https://media.example.invalid" })).toBe(ID);
    expect(await ports.fail({ id: ID, token: TOKEN, retry: true })).toMatchObject({ id: ID });
    expect(backend.seen.map(({ path, body }) => ({ path, body }))).toEqual([
      { path: "/rest/v1/rpc/claim_product_media_job", body: { p_seconds: 300 } },
      { path: "/rest/v1/rpc/finish_product_media_job", body: { p_id: ID, p_token: TOKEN, p_receipt: receipt, p_base: "https://media.example.invalid" } },
      { path: "/rest/v1/rpc/fail_product_media_job", body: { p_id: ID, p_token: TOKEN, p_retry: true } },
    ]);
    expect(backend.seen.every((item) => item.method === "POST" && item.apikey === SECRET && item.authorization === undefined)).toBe(true);
    expect(JSON.stringify(backend.seen.map((item) => item.body))).not.toContain(SECRET);
  });

  it("returns no job for an empty claim result", async () => {
    const backend = await fixture((_path, response) => response.writeHead(200, { "content-type": "application/json" }).end("[]"));
    cleanup.push(backend.close);
    const ports = createMediaJobPorts({ SUPABASE_URL: backend.url, MEDIA_SUPABASE_KEY: SECRET });
    expect(await ports.claim(300)).toBeNull();
  });

  it("rejects a malformed claimed row without exposing backend text", async () => {
    const backend = await fixture((_path, response) => response.writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify([{ ...job, source_key: "../private" }])));
    cleanup.push(backend.close);
    const ports = createMediaJobPorts({ SUPABASE_URL: backend.url, MEDIA_SUPABASE_KEY: SECRET });
    await expect(ports.claim(300)).rejects.toMatchObject({ code: "media_backend_unavailable" });
  });

  it("never forwards a private key to an HTTP redirect destination", async () => {
    const backend = await fixture((path, response) => {
      if (path.includes("/rpc/")) response.writeHead(302, { location: "/sink" }).end();
      else response.writeHead(200).end("secret leaked");
    });
    cleanup.push(backend.close);
    const ports = createMediaJobPorts({ SUPABASE_URL: backend.url, MEDIA_SUPABASE_KEY: SECRET });
    await expect(ports.claim(300)).rejects.toMatchObject({ code: "media_backend_unavailable" });
    expect(backend.seen.map((item) => item.path)).toEqual(["/rest/v1/rpc/claim_product_media_job"]);
  });

  it("rejects a non-loopback HTTP backend before any fetch", () => {
    expect(() => createMediaJobPorts({ SUPABASE_URL: "http://public.example.invalid", MEDIA_SUPABASE_KEY: SECRET }))
      .toThrowError(expect.objectContaining({ code: "media_backend_unavailable" }));
  });

  it("rejects invalid lease and receipt inputs before contacting the database", async () => {
    const backend = await fixture((_path, response) => response.writeHead(200, { "content-type": "application/json" }).end("[]"));
    cleanup.push(backend.close);
    const ports = createMediaJobPorts({ SUPABASE_URL: backend.url, MEDIA_SUPABASE_KEY: SECRET });
    await expect(ports.claim(601)).rejects.toMatchObject({ code: "media_backend_unavailable" });
    await expect(ports.finish({ id: ID, token: TOKEN, receipt: { master: { body: "private" } }, publicBase: "https://media.example.invalid" }))
      .rejects.toMatchObject({ code: "media_backend_unavailable" });
    await expect(ports.fail({ id: ID, token: TOKEN, retry: "yes" as unknown as boolean }))
      .rejects.toMatchObject({ code: "media_backend_unavailable" });
    expect(backend.seen).toEqual([]);
  });

  it("maps a failed backend response to a fixed error without leaking its text", async () => {
    const backend = await fixture((_path, response) => response.writeHead(503, { "content-type": "application/json" })
      .end(JSON.stringify({ error: SECRET, message: "private database detail" })));
    cleanup.push(backend.close);
    const ports = createMediaJobPorts({ SUPABASE_URL: backend.url, MEDIA_SUPABASE_KEY: SECRET });
    let error: unknown;
    try { await ports.claim(); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: "media_backend_unavailable", message: "media_backend_unavailable" });
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(String(error)).not.toContain("private database detail");
  });

  it("uses a bearer header only for legacy service-role JWT keys", async () => {
    const backend = await fixture((_path, response) => response.writeHead(200, { "content-type": "application/json" }).end("[]"));
    cleanup.push(backend.close);
    const jwt = "eyJhbGciOiJIUzI1NiJ9.fixture.signature";
    const ports = createMediaJobPorts({ SUPABASE_URL: backend.url, MEDIA_SUPABASE_KEY: jwt });
    expect(await ports.claim()).toBeNull();
    expect(backend.seen[0]).toMatchObject({ apikey: jwt, authorization: `Bearer ${jwt}` });
    expect(backend.seen[0].body).toEqual({ p_seconds: 300 });
  });
});

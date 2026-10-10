import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { captureCatalogPublication, createCatalogPublicationCaptureSource } from "@/cloudflare/static-build/producer/catalog-publication-capture";

const releaseId = "20000000-0000-4000-8000-000000000001";
const input = { expectedRevision: 12, releaseId, capabilityHash: "a".repeat(64) };
const receipt = { releaseId, revision: 12, sha256: "b".repeat(64), documentCount: 17 };
const secret = "sb_secret_fake15";

describe("private atomic catalog capture port", () => {
  it("makes one atomic capture call and returns only its matching sealed receipt", async () => {
    const capture = vi.fn().mockResolvedValue(receipt);
    expect(await captureCatalogPublication({ ...input, source: { capture } })).toEqual(receipt);
    expect(capture).toHaveBeenCalledExactlyOnceWith(input);
  });
  it.each([0, 20_000])("accepts a confirmed boundary document count %s", async (documentCount) => {
    expect(await captureCatalogPublication({ ...input, source: { capture: async () => ({ ...receipt, documentCount }) } })).toEqual({ ...receipt, documentCount });
  });
  it.each([-1, 1.2, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid revision %s before a call", async (expectedRevision) => {
    const capture = vi.fn();
    await expect(captureCatalogPublication({ ...input, expectedRevision, source: { capture } })).rejects.toMatchObject({ code: "capture_input_invalid" });
    expect(capture).not.toHaveBeenCalled();
  });
  it.each([{ releaseId: "invalid" }, { capabilityHash: "raw-secret" }, { capabilityHash: "A".repeat(64) }])("rejects malformed identity %j", async (change) => {
    const capture = vi.fn();
    await expect(captureCatalogPublication({ ...input, ...change, source: { capture } })).rejects.toMatchObject({ code: "capture_input_invalid" });
    expect(capture).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { ...receipt, revision: 13 }, { ...receipt, releaseId: "other" },
    { ...receipt, sha256: "invalid" }, { ...receipt, documentCount: -1 },
    { ...receipt, documentCount: 20_001 }, { ...receipt, capability_hash: "secret" }])("rejects unconfirmed or secret-bearing receipt %#", async (value) => {
    await expect(captureCatalogPublication({ ...input, source: { capture: async () => value } })).rejects.toMatchObject({ code: "capture_response_invalid" });
  });
  it("does not echo backend errors or automatically retry an uncertain write", async () => {
    const capture = vi.fn().mockRejectedValue(new Error(secret));
    const error = await captureCatalogPublication({ ...input, source: { capture } }).catch((e: unknown) => e);
    expect(error).toMatchObject({ message: "Catalog capture unavailable", code: "capture_unavailable" });
    expect(String(error)).not.toContain(secret);
    expect(capture).toHaveBeenCalledTimes(1);
  });
  it("uses the private key only in headers, no capability in URL, and no redirect", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(receipt));
    const source = createCatalogPublicationCaptureSource({ SUPABASE_URL: "http://127.0.0.1:56421", ADMIN_SUPABASE_KEY: secret }, fetcher);
    expect(await captureCatalogPublication({ ...input, source })).toEqual(receipt);
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://127.0.0.1:56421/rest/v1/rpc/capture_catalog_publication");
    expect(new Headers(init.headers).get("apikey")).toBe(secret);
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(String(init.body))).toEqual({ expected_revision: 12, release_id: releaseId, capability_hash: input.capabilityHash });
    expect(String(init.body)).not.toContain(secret);
  });
  it.each(["sb_publishable_test", "", "bad\nkey", "eyJinvalid"])("rejects non-private or invalid key %# before fetch", async (key) => {
    const fetcher = vi.fn();
    expect(() => createCatalogPublicationCaptureSource({ SUPABASE_URL: "https://catalog.example.test", ADMIN_SUPABASE_KEY: key }, fetcher)).toThrow("Catalog capture unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["http://external.example.test", "https://user:pass@example.test", "https://example.test/?key=x", "https://example.test/path", "bad"])("rejects ambiguous or insecure origin %s", (url) => {
    expect(() => createCatalogPublicationCaptureSource({ SUPABASE_URL: url, ADMIN_SUPABASE_KEY: secret })).toThrow("Catalog capture unavailable");
  });
  it.each([302, 401, 403, 409, 500, 503])("rejects HTTP %s without retry", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status }));
    const source = createCatalogPublicationCaptureSource({ SUPABASE_URL: "http://127.0.0.1:56421", ADMIN_SUPABASE_KEY: secret }, fetcher);
    await expect(captureCatalogPublication({ ...input, source })).rejects.toMatchObject({ code: "capture_unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds response bytes even for a 200 receipt", async () => {
    const source = createCatalogPublicationCaptureSource({ SUPABASE_URL: "http://127.0.0.1:56421", ADMIN_SUPABASE_KEY: secret }, vi.fn().mockResolvedValue(new Response("x".repeat(65_537))));
    await expect(captureCatalogPublication({ ...input, source })).rejects.toMatchObject({ code: "capture_unavailable" });
  });
  it("supports legacy private JWT headers but rejects public-role JWTs", async () => {
    const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.fixture`;
    const fetcher = vi.fn().mockResolvedValue(Response.json(receipt));
    const source = createCatalogPublicationCaptureSource({ SUPABASE_URL: "http://127.0.0.1:56421", ADMIN_SUPABASE_KEY: jwt("service_role") }, fetcher);
    await captureCatalogPublication({ ...input, source });
    expect(new Headers(fetcher.mock.calls[0][1].headers).get("authorization")).toBe(`Bearer ${jwt("service_role")}`);
    expect(() => createCatalogPublicationCaptureSource({ SUPABASE_URL: "http://127.0.0.1:56421", ADMIN_SUPABASE_KEY: jwt("anon") })).toThrow("Catalog capture unavailable");
  });
  it.each([{ args: [] }, { args: ["--deploy"] }, { args: ["--local", "--revision", "12", "--release", releaseId] }])("CLI rejects missing flags or remote origin without leaking env %#", ({ args }) => {
    const result = spawnSync(process.execPath, [path.resolve("scripts/cloudflare/capture-catalog-publication.mjs"), ...args], {
      encoding: "utf8", timeout: 10_000, windowsHide: true,
      env: { ...process.env, SUPABASE_URL: "https://remote.example.invalid", ADMIN_SUPABASE_KEY: secret, CATALOG_PUBLICATION_CAPABILITY_HASH: input.capabilityHash },
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ ok: false, code: "catalog_capture_failed" });
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    expect(`${result.stdout}${result.stderr}`).not.toContain(input.capabilityHash);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createPublicationControlClient } from "@/cloudflare/publication/publication-control";
const releaseId = "20000000-0000-4000-8000-000000000001";
const previousId = "20000000-0000-4000-8000-000000000002";
const token = "30000000-0000-4000-8000-000000000001";
const receipt = { releaseId, revision: 7, releaseSha256: "a".repeat(64) };
const bindings = { SUPABASE_URL: "http://127.0.0.1:56421", PUBLICATION_SUPABASE_KEY: "sb_secret_fake17" };
describe("private publication control client", () => {
  it("reads one strict active identity or an empty pointer without inventing metadata", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(receipt)).mockResolvedValueOnce(Response.json(null));
    const client = createPublicationControlClient(bindings, fetcher);
    expect(await client.current()).toEqual(receipt);
    expect(await client.current()).toBeNull();
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(bindings.SUPABASE_URL + "/rest/v1/rpc/read_publication_control");
    expect(JSON.parse(String(init.body))).toEqual({});
    expect(new Headers(init.headers).get("apikey")).toBe(bindings.PUBLICATION_SUPABASE_KEY);
    expect(init.redirect).toBe("manual");
  });
  it("marks exactly the expected release/hash/revision under the job lease", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(true));
    const client = createPublicationControlClient(bindings, fetcher);
    expect(await client.markReady({ ...receipt, leaseToken: token })).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/rest/v1/rpc/mark_catalog_publication_ready");
    expect(JSON.parse(String(init.body))).toEqual({ expected_revision: 7, release_id: releaseId,
      release_sha256: receipt.releaseSha256, lease_token: token });
    expect(url.href).not.toContain(token);
    expect(String(init.body)).not.toContain(bindings.PUBLICATION_SUPABASE_KEY);
  });
  it("compares exact old/new IDs and keeps a refused CAS as false", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json(false));
    const client = createPublicationControlClient(bindings, fetcher);
    expect(await client.compareAndSet(null, releaseId)).toBe(true);
    expect(await client.compareAndSet(releaseId, previousId)).toBe(false);
    expect(fetcher.mock.calls.map(([url]) => (url as URL).pathname))
      .toEqual(["/rest/v1/rpc/compare_and_set_catalog_publication", "/rest/v1/rpc/compare_and_set_catalog_publication"]);
    expect(JSON.parse(String(fetcher.mock.calls[1][1].body))).toEqual({
      expected_release_id: releaseId, next_release_id: previousId });
  });
  it.each([{}, [], "private-token", { ...receipt, revision: "7" }, { ...receipt, releaseId: "bad" },
    { ...receipt, releaseSha256: "bad" }, { ...receipt, capability: "private-token" }])(
    "rejects malformed or secret-bearing active response %#", async (value) => {
      const client = createPublicationControlClient(bindings, async () => Response.json(value));
      await expect(client.current()).rejects.toThrow(/^publication_control_unavailable$/);
    });
  it("rejects bad inputs before fetch and requires booleans for writes", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, secret: "private-token" }));
    const client = createPublicationControlClient(bindings, fetcher);
    for (const invalid of [{ ...receipt, revision: -1 }, { ...receipt, revision: 0 },
      { ...receipt, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...receipt, releaseSha256: "bad" }]) {
      await expect(client.markReady({ ...invalid, leaseToken: token })).rejects.toThrow("publication_control_unavailable");
    }
    await expect(client.markReady({ ...receipt, leaseToken: "private-token" })).rejects.toThrow("publication_control_unavailable");
    await expect(client.compareAndSet("bad", releaseId)).rejects.toThrow("publication_control_unavailable");
    await expect(client.compareAndSet(null, "bad")).rejects.toThrow("publication_control_unavailable");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(client.markReady({ ...receipt, leaseToken: token })).rejects.toThrow(/^publication_control_unavailable$/);
    await expect(client.compareAndSet(null, releaseId)).rejects.toThrow(/^publication_control_unavailable$/);
  });
  it("does not accept public keys or unsafe origins", () => {
    const fetcher = vi.fn();
    for (const input of [{ ...bindings, PUBLICATION_SUPABASE_KEY: "sb_publishable_test" },
      { ...bindings, SUPABASE_URL: "http://external.example.test" },
      { ...bindings, SUPABASE_URL: "https://user:private-token@example.test" },
      { ...bindings, SUPABASE_URL: "https://example.test/path" },
      { ...bindings, SUPABASE_URL: "https://example.test/?token=private-token" }]) {
      expect(() => createPublicationControlClient(input, fetcher)).toThrow(/^publication_control_unavailable$/);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([302, 401, 403, 409, 500])("contains HTTP %s and never retries unknown writes", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("private-token", { status }));
    const client = createPublicationControlClient(bindings, fetcher);
    await expect(client.markReady({ ...receipt, leaseToken: token })).rejects.toThrow(/^publication_control_unavailable$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("contains lost responses and oversized bodies", async () => {
    for (const fetcher of [vi.fn().mockRejectedValue(new Error("private-token")),
      vi.fn().mockResolvedValue(new Response("x".repeat(65_537), { headers: { "content-type": "application/json" } }))]) {
      const client = createPublicationControlClient(bindings, fetcher);
      await expect(client.compareAndSet(null, releaseId)).rejects.toThrow(/^publication_control_unavailable$/);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});

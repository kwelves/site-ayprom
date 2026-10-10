import { describe, expect, it, vi } from "vitest";
import { readPublicContentRevision, runRevisionFencedWork } from "@/cloudflare/static-build/producer/publication-revision";

const url = "https://project.supabase.co";
const key = "sb_publishable_test_only";

function response(body: string, status = 200, headers = { "content-type": "application/json" }) {
  return new Response(body, { status, headers });
}

describe("public catalog publication revision", () => {
  it("reads a safe integer through the public RPC with no private key", async () => {
    const fetchImpl = vi.fn(async () => response("7"));
    await expect(readPublicContentRevision({ url, key, fetchImpl })).resolves.toBe(7);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [requestUrl, options] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(requestUrl.href).toBe(`${url}/rest/v1/rpc/get_content_revision`);
    expect(options).toMatchObject({ method: "POST", redirect: "manual", headers: { apikey: key } });
    expect(JSON.stringify(options)).not.toContain("service_role");
  });

  it.each(["sb_secret_private", "", "not-a-public-key"])("rejects a non-public key before fetch", async (badKey) => {
    const fetchImpl = vi.fn(async () => response("1"));
    await expect(readPublicContentRevision({ url, key: badKey, fetchImpl })).rejects.toThrow("publication_revision_unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["http://other.example", "https://user:pass@project.supabase.co", "https://project.supabase.co/other"])(
    "rejects unsafe origin before fetch",
    async (badUrl) => {
      const fetchImpl = vi.fn(async () => response("1"));
      await expect(readPublicContentRevision({ url: badUrl, key, fetchImpl })).rejects.toThrow("publication_revision_unavailable");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each(["-1", "1.5", "9007199254740992", "null", "{}", "\"1\"", "not-json"])(
    "fails closed on malformed revision %s", async (body) => {
      await expect(readPublicContentRevision({ url, key, fetchImpl: async () => response(body) }))
        .rejects.toThrow("publication_revision_unavailable");
    },
  );

  it("does not follow redirects or accept a backend outage", async () => {
    const redirected = vi.fn(async () => response("1", 302, { "content-type": "application/json" }));
    await expect(readPublicContentRevision({ url, key, fetchImpl: redirected })).rejects.toThrow("publication_revision_unavailable");
    expect(redirected).toHaveBeenCalledOnce();
    await expect(readPublicContentRevision({ url, key, fetchImpl: async () => response("1", 503) }))
      .rejects.toThrow("publication_revision_unavailable");
  });

  it("rejects a large response without including its contents in the error", async () => {
    const secret = "sensitive-test-data";
    const fetchImpl = async () => response(secret.repeat(100));
    await expect(readPublicContentRevision({ url, key, fetchImpl })).rejects.toThrow("publication_revision_unavailable");
    try { await readPublicContentRevision({ url, key, fetchImpl }); }
    catch (error) { expect(String(error)).not.toContain(secret); }
  });

  it("returns staged work only when the revision is unchanged", async () => {
    const events: string[] = [];
    const read = vi.fn(async () => { events.push("read"); return 3; });
    const result = await runRevisionFencedWork(read, async (revision) => {
      events.push("build");
      expect(revision).toBe(3);
      return { stagingDir: "test-staging" };
    });
    expect(result).toEqual({ revision: 3, value: { stagingDir: "test-staging" } });
    expect(events).toEqual(["read", "build", "read"]);
  });

  it("rejects stale staged work when revision changes during the build", async () => {
    const read = vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    await expect(runRevisionFencedWork(read, async () => ({ stagingDir: "stale" })))
      .rejects.toThrow("publication_revision_changed");
  });

  it("does not begin work when the first read fails, and never returns work when the second read fails", async () => {
    const build = vi.fn(async () => "staging");
    await expect(runRevisionFencedWork(async () => { throw new Error("backend-secret"); }, build))
      .rejects.toThrow("publication_revision_unavailable");
    expect(build).not.toHaveBeenCalled();
    const read = vi.fn().mockResolvedValueOnce(3).mockRejectedValueOnce(new Error("backend-secret"));
    await expect(runRevisionFencedWork(read, build)).rejects.toThrow("publication_revision_unavailable");
    expect(build).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createPublicationQueueClient } from "@/cloudflare/static-build/producer/publication-queue";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const BINDINGS = { SUPABASE_URL: "https://project.supabase.co", PUBLICATION_SUPABASE_KEY: "sb_secret_test123" };

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("service-only publication queue client", () => {
  it("claims a revision and sends the private key only in headers", async () => {
    const fetcher = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(async () => response([{ revision: 7, token: TOKEN }]));
    const client = createPublicationQueueClient(BINDINGS, fetcher as typeof fetch);
    await expect(client.claim(900, 30)).resolves.toEqual({ revision: 7, token: TOKEN });
    const [url, init] = fetcher.mock.calls[0];
    expect(url.pathname).toBe("/rest/v1/rpc/claim_publication_job");
    expect(url.toString()).not.toContain(BINDINGS.PUBLICATION_SUPABASE_KEY);
    expect(new Headers(init.headers).get("apikey")).toBe(BINDINGS.PUBLICATION_SUPABASE_KEY);
    expect(JSON.parse(String(init.body))).toEqual({ p_lease_seconds: 900, p_debounce_seconds: 30 });
  });

  it("treats no work as null and rejects malformed claims", async () => {
    const empty = createPublicationQueueClient(BINDINGS, async () => response([]));
    await expect(empty.claim()).resolves.toBeNull();
    for (const value of [[{ revision: 7, token: "not-a-token" }], [{ revision: "7", token: TOKEN }],
      [{ revision: 7, token: TOKEN }, { revision: 8, token: TOKEN }], {}, null]) {
      const client = createPublicationQueueClient(BINDINGS, async () => response(value));
      await expect(client.claim()).rejects.toThrow("publication_queue_unavailable");
    }
  });

  it("confirms only a valid revision and deployment identifier", async () => {
    const fetcher = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(async () => response(true));
    const client = createPublicationQueueClient(BINDINGS, fetcher as typeof fetch);
    await expect(client.confirm(TOKEN, 7, "cf:deployment-7")).resolves.toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(url.pathname).toBe("/rest/v1/rpc/confirm_publication_job");
    expect(JSON.parse(String(init.body))).toEqual({ p_token: TOKEN, p_revision: 7,
      p_deployment_identifier: "cf:deployment-7" });
    await expect(client.confirm(TOKEN, 7, "bad/identifier")).rejects.toThrow("publication_queue_unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("renews only a valid active lease through the service RPC", async () => {
    const fetcher = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(async () => response(true));
    const client = createPublicationQueueClient(BINDINGS, fetcher as typeof fetch);
    await expect(client.renew(TOKEN, 7, 900)).resolves.toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(url.pathname).toBe("/rest/v1/rpc/renew_publication_job");
    expect(JSON.parse(String(init.body))).toEqual({ p_token: TOKEN, p_revision: 7, p_lease_seconds: 900 });
    await expect(client.renew("bad", 7, 900)).rejects.toThrow("publication_queue_unavailable");
    await expect(client.renew(TOKEN, 0, 900)).rejects.toThrow("publication_queue_unavailable");
    await expect(client.renew(TOKEN, 7, 29)).rejects.toThrow("publication_queue_unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails and retries through explicit service RPCs", async () => {
    const fetcher = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(async () => response(false));
    const client = createPublicationQueueClient(BINDINGS, fetcher as typeof fetch);
    await expect(client.fail(TOKEN, "build_failed")).resolves.toBe(false);
    await expect(client.retry()).resolves.toBe(false);
    expect(fetcher.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/rest/v1/rpc/fail_publication_job", "/rest/v1/rpc/retry_publication_job",
    ]);
    // Runtime validation still applies if an untyped caller supplies a bad code.
    await expect(client.fail(TOKEN, "secret-in-error" as never)).rejects.toThrow("publication_queue_unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects public keys, unsafe URLs and bad input before fetch", async () => {
    const fetcher = vi.fn(async () => response([]));
    for (const bindings of [
      { ...BINDINGS, PUBLICATION_SUPABASE_KEY: "sb_publishable_test123" },
      { ...BINDINGS, SUPABASE_URL: "https://user:password@project.supabase.co" },
      { ...BINDINGS, SUPABASE_URL: "http://project.supabase.co" },
    ]) expect(() => createPublicationQueueClient(bindings, fetcher as typeof fetch)).toThrow("publication_queue_unavailable");
    const client = createPublicationQueueClient(BINDINGS, fetcher as typeof fetch);
    await expect(client.claim(1, 0)).rejects.toThrow("publication_queue_unavailable");
    await expect(client.confirm("bad", 7, "deploy-7")).rejects.toThrow("publication_queue_unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps outage details and secrets out of errors", async () => {
    const client = createPublicationQueueClient(BINDINGS, async () => { throw new Error("secret backend details"); });
    await expect(client.claim()).rejects.toThrow("publication_queue_unavailable");
    const malformed = createPublicationQueueClient(BINDINGS, async () => response({ secret: "body-secret" }, 503));
    await expect(malformed.retry()).rejects.toThrow("publication_queue_unavailable");
  });
});

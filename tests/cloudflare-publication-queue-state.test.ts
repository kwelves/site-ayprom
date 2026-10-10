import { describe, expect, it, vi } from "vitest";
import { createPublicationQueueClient } from "@/cloudflare/static-build/producer/publication-queue";

const token = "11111111-1111-4111-8111-111111111111";
const bindings = { SUPABASE_URL: "https://project.supabase.co", PUBLICATION_SUPABASE_KEY: "sb_secret_test123" };
const state = { deployedRevision: 7, deploymentIdentifier: "cf:deployment-7",
  leaseRevision: 8, leaseOwned: true, leaseValid: true };
const client = (body: unknown, status = 200) => createPublicationQueueClient(bindings, async () => Response.json(body, { status }));

describe("private publication confirmation reconciliation", () => {
  it("reads exact safe state and keeps lease tokens in the private request", async () => {
    const fetcher = vi.fn(async () => Response.json(state));
    const queue = createPublicationQueueClient(bindings, fetcher);
    await expect(queue.state(token)).resolves.toEqual(state);
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/rest/v1/rpc/read_publication_job");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ p_token: token });
    expect(new Headers(init.headers).get("apikey")).toBe(bindings.PUBLICATION_SUPABASE_KEY);
  });
  it("preserves absent queue and unleased initial state", async () => {
    await expect(client(null).state(token)).resolves.toBeNull();
    await expect(client({ deployedRevision: 0, deploymentIdentifier: null, leaseRevision: null,
      leaseOwned: false, leaseValid: false }).state(token)).resolves.toEqual({
      deployedRevision: 0, deploymentIdentifier: null, leaseRevision: null, leaseOwned: false, leaseValid: false });
  });
  it("distinguishes an expired own lease from a valid foreign lease", async () => {
    await expect(client({ ...state, leaseValid: false }).state(token)).resolves.toMatchObject({ leaseOwned: true, leaseValid: false });
    await expect(client({ ...state, leaseOwned: false }).state(token)).resolves.toMatchObject({ leaseOwned: false, leaseValid: true });
  });
  it.each([
    { ...state, leaseToken: token }, { ...state, deployedRevision: "7" },
    { ...state, deployedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...state, deploymentIdentifier: "../secret" }, { ...state, deploymentIdentifier: null },
    { ...state, leaseRevision: null }, { ...state, leaseRevision: 0 },
    { ...state, leaseOwned: "true" }, { ...state, leaseValid: null }, [],
  ])("rejects malformed or credential-bearing state %#", async (body) => {
    await expect(client(body).state(token)).rejects.toThrow("publication_queue_unavailable");
  });
  it("rejects invalid tokens before any request", async () => {
    const fetcher = vi.fn(async () => Response.json(state));
    await expect(createPublicationQueueClient(bindings, fetcher).state("bad/token")).rejects.toThrow("publication_queue_unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not retry lost replies or forward server details", async () => {
    const fetcher = vi.fn(async () => { throw new Error("backend-secret"); });
    await expect(createPublicationQueueClient(bindings, fetcher).state(token)).rejects.toThrow("publication_queue_unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(client({ secret: "backend-secret" }, 503).state(token)).rejects.toThrow("publication_queue_unavailable");
    await expect(client(state, 201).state(token)).rejects.toThrow("publication_queue_unavailable");
  });
});

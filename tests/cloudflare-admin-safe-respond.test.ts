import { afterEach, describe, expect, it, vi } from "vitest";
import { respondSafely } from "@/cloudflare/admin-worker/safe-respond";
import { configureSentry } from "@/cloudflare/admin-worker/shims/sentry";

const DSN = "https://0123456789abcdef0123456789abcdef@o123456.ingest.de.sentry.io/4511000000000001";

afterEach(() => {
  configureSentry({});
  vi.restoreAllMocks();
});

function context() {
  const pending: Promise<unknown>[] = [];
  return { pending, ctx: { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } };
}

describe("respondSafely", () => {
  it("passes a normal answer through untouched", async () => {
    const { ctx } = context();
    const answer = new Response("ok", { status: 201 });
    expect(await respondSafely(async () => answer, ctx)).toBe(answer);
  });

  it("answers an uncaught failure with a plain 500 that says nothing about the cause, and reports it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    configureSentry({ SENTRY_DSN: DSN }, fetchImpl as unknown as typeof fetch);
    const { ctx, pending } = context();
    const response = await respondSafely(async () => { throw new Error("database password is hunter2"); }, ctx);
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("Internal error");
    await Promise.all(pending);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).not.toContain("hunter2");
  });

  it("still answers when Sentry is not configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { ctx } = context();
    const response = await respondSafely(async () => { throw new Error("x"); }, ctx);
    expect(response.status).toBe(500);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { captureException, configureSentry } from "@/cloudflare/admin-worker/shims/sentry";
import { runWithBackground } from "@/lib/background-tasks";

const DSN = "https://0123456789abcdef0123456789abcdef@o123456.ingest.de.sentry.io/4511000000000001";

afterEach(() => {
  configureSentry({}); // back to "not configured"
  vi.restoreAllMocks();
});

async function capture(error: unknown, hint?: { tags?: Record<string, unknown> }) {
  const background: Promise<unknown>[] = [];
  const result = await runWithBackground((promise) => background.push(promise), async () => captureException(error, hint));
  await Promise.all(background);
  return result;
}

describe("admin Worker Sentry stand-in", () => {
  it("only logs the class of the error, and sends nothing, when no Sentry address is configured", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn();
    configureSentry({}, fetchImpl as unknown as typeof fetch);
    await capture(new RangeError("secret text anna@example.com"));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[admin] captured_exception RangeError");
    expect(JSON.stringify(log.mock.calls)).not.toContain("anna@example.com");
  });

  it("sends the error to Sentry in the background once an address is configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    configureSentry({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "production" }, fetchImpl as unknown as typeof fetch);
    await capture(new TypeError("x"), { tags: { subsystem: "admin-storage-cleanup", entityType: "brand" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o123456.ingest.de.sentry.io/api/4511000000000001/envelope/");
    const payload = JSON.parse(String(init.body).split("\n")[2]);
    expect(payload).toMatchObject({ environment: "production", tags: { subsystem: "admin-storage-cleanup", entityType: "brand", runtime: "cloudflare-admin-worker" } });
    expect(String(init.body)).not.toContain("\"x\"");
  });

  it("ignores an address that is not a Sentry one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchImpl = vi.fn();
    configureSentry({ SENTRY_DSN: "https://key@evil.example/1" }, fetchImpl as unknown as typeof fetch);
    await capture(new Error("x"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { buildSentryEnvelope, createSentryReporter, parseSentryDsn } from "@/lib/error-reporting/sentry-lite";

const DSN = "https://0123456789abcdef0123456789abcdef@o123456.ingest.de.sentry.io/4511000000000001";

describe("parseSentryDsn", () => {
  it("reads the key, host and project of a Sentry address", () => {
    expect(parseSentryDsn(DSN)).toEqual({
      publicKey: "0123456789abcdef0123456789abcdef",
      envelopeUrl: "https://o123456.ingest.de.sentry.io/api/4511000000000001/envelope/",
      dsn: DSN,
    });
  });

  it("accepts nothing that is not an https address on sentry.io", () => {
    for (const bad of [
      undefined, "", "   ", "not a url",
      "http://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/1",
      "https://0123456789abcdef0123456789abcdef@evil.example/1",
      "https://0123456789abcdef0123456789abcdef@sentry.io.evil.example/1",
      "https://@o1.ingest.sentry.io/1",
      "https://key@o1.ingest.sentry.io/",
      "https://key@o1.ingest.sentry.io/abc",
    ]) {
      expect(parseSentryDsn(bad)).toBeNull();
    }
  });
});

describe("buildSentryEnvelope", () => {
  function envelopeFor(error: unknown, tags?: Record<string, string>) {
    const parsed = parseSentryDsn(DSN)!;
    const body = buildSentryEnvelope({
      dsn: parsed, error, eventId: "a".repeat(32), timestampSeconds: 1_800_000_000, environment: "production", runtime: "cloudflare-worker", tags,
    });
    const [header, itemHeader, payload] = body.split("\n").map((line) => JSON.parse(line));
    return { body, header, itemHeader, payload };
  }

  it("is a Sentry envelope with one error event", () => {
    const { header, itemHeader, payload } = envelopeFor(new TypeError("boom"));
    expect(header).toMatchObject({ event_id: "a".repeat(32), dsn: DSN });
    expect(itemHeader).toEqual({ type: "event" });
    expect(payload).toMatchObject({ event_id: "a".repeat(32), level: "error", environment: "production", timestamp: 1_800_000_000 });
    expect(payload.exception.values[0].type).toBe("TypeError");
  });

  it("never sends the text of the error: messages can hold names, e-mails or other personal data", () => {
    const secret = new Error("duplicate key for anna@example.com, phone +996 555 123456");
    const { body } = envelopeFor(secret);
    expect(body).not.toContain("anna@example.com");
    expect(body).not.toContain("996");
    expect(body).not.toContain("duplicate key");
  });

  it("sends the stack as function and file positions without query strings", () => {
    const error = new Error("x");
    error.stack = [
      "Error: x",
      "    at updateProduct (file:///worker/index.js:120:15)",
      "    at async handle (https://ayprom.example/admin/index.js?v=abc123:8:3)",
    ].join("\n");
    const frames = envelopeFor(error).payload.exception.values[0].stacktrace.frames;
    // Sentry wants the oldest call first.
    expect(frames.map((frame: { function?: string }) => frame.function)).toEqual(["handle", "updateProduct"]);
    expect(frames[1]).toMatchObject({ filename: "file:///worker/index.js", lineno: 120, colno: 15, in_app: true });
    expect(JSON.stringify(frames)).not.toContain("abc123");
  });

  it("keeps only short text tags, so a caller cannot pass personal data along", () => {
    const { payload } = envelopeFor(new Error("x"), { subsystem: "admin-storage-cleanup", entityType: "brand", note: "a".repeat(200), count: 5 as unknown as string });
    expect(payload.tags).toEqual({ subsystem: "admin-storage-cleanup", entityType: "brand", runtime: "cloudflare-worker" });
  });

  it("copes with something that is not an Error", () => {
    expect(envelopeFor("a string").payload.exception.values[0].type).toBe("string");
    expect(envelopeFor(undefined).payload.exception.values[0].type).toBe("undefined");
  });
});

describe("createSentryReporter", () => {
  function reporter(options: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
    const fetchImpl = options.fetchImpl ?? vi.fn(async () => new Response("{}", { status: 200 }));
    return { fetchImpl, report: createSentryReporter({ dsn: DSN, environment: "production", runtime: "cloudflare-worker", fetchImpl, now: options.now ?? (() => 1_800_000_000_000) })! };
  }

  it("posts the envelope to the project, with the key in the auth header", async () => {
    const { fetchImpl, report } = reporter();
    await report(new Error("x"));
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://o123456.ingest.de.sentry.io/api/4511000000000001/envelope/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Sentry-Auth"]).toContain("sentry_key=0123456789abcdef0123456789abcdef");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-sentry-envelope");
  });

  it("does nothing without a valid address", () => {
    expect(createSentryReporter({ dsn: undefined, environment: "production", runtime: "x" })).toBeNull();
    expect(createSentryReporter({ dsn: "garbage", environment: "production", runtime: "x" })).toBeNull();
  });

  it("never throws, even when the network fails or hangs", async () => {
    const failing = reporter({ fetchImpl: vi.fn(async () => { throw new Error("network down"); }) });
    await expect(failing.report(new Error("x"))).resolves.toBeUndefined();
    const rejecting = reporter({ fetchImpl: vi.fn(async () => new Response("no", { status: 429 })) });
    await expect(rejecting.report(new Error("x"))).resolves.toBeUndefined();
  });

  it("sends the same error from the same place once a minute, so a loop cannot use up the monthly quota", async () => {
    let clock = 1_800_000_000_000;
    const { fetchImpl, report } = reporter({ now: () => clock });
    const failure = () => { const error = new Error("x"); error.stack = "Error: x\n    at same (index.js:1:1)"; return error; };
    await report(failure());
    await report(failure());
    await report(failure());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock += 61_000;
    await report(failure());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends at most twenty different errors a minute", async () => {
    const { fetchImpl, report } = reporter();
    for (let i = 0; i < 30; i += 1) {
      const error = new Error("x");
      error.stack = `Error: x\n    at place${i} (index.js:${i}:1)`;
      await report(error);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(20);
  });
});

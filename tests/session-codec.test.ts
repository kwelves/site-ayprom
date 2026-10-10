import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, getSessionPayload, SESSION_DURATION_SECONDS } from "@/lib/admin/session";

const SECRET = "local-session-parity-secret-at-least-32-bytes";
const START = Date.parse("2026-09-27T12:00:00.000Z");
// Golden value independently calculated from the pre-extraction legacy payload
// format and Node's HMAC-SHA256, not from either current implementation.
const LEGACY_TOKEN = "eyJpYXQiOjE3OTA1MTAzNDAwMDAsImV4cCI6MTc5MTExNTIwMDAwMCwiY3JlZGVudGlhbFZlcnNpb24iOjd9.hYhWKL2UEqX9uqyNKh9RGyNN0jaYwk6oaZw9XCJgcZs";

describe("platform-neutral admin session codec", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => vi.useRealTimers());

  it("produces the same bytes as legacy and mutually reads both tokens", async () => {
    const { createSessionCodec } = await import("@/lib/admin/session-codec");
    const codec = createSessionCodec(SECRET, () => Date.now());
    const options = { originalIssuedAt: START - 60_000, credentialVersion: 7 };
    const legacy = await createSessionToken(options);
    const worker = await codec.create(options);

    expect(legacy).toBe(LEGACY_TOKEN);
    expect(worker).toBe(LEGACY_TOKEN);
    expect(worker).toBe(legacy);
    expect(await codec.read(legacy)).toEqual({
      iat: options.originalIssuedAt,
      exp: START + SESSION_DURATION_SECONDS * 1000,
      credentialVersion: 7,
    });
    expect(await getSessionPayload(worker)).toEqual(await codec.read(legacy));
  });

  it("preserves the original issue time when refreshed in the last hour", async () => {
    const { createSessionCodec } = await import("@/lib/admin/session-codec");
    const codec = createSessionCodec(SECRET, () => Date.now());
    const originalIssuedAt = START - (SESSION_DURATION_SECONDS - 30 * 60) * 1000;
    const refreshed = await codec.create({ originalIssuedAt, credentialVersion: 2 });

    expect(await getSessionPayload(refreshed)).toEqual({
      iat: originalIssuedAt,
      exp: START + SESSION_DURATION_SECONDS * 1000,
      credentialVersion: 2,
    });
  });

  it("caps refresh at thirty days from original login", async () => {
    const { createSessionCodec } = await import("@/lib/admin/session-codec");
    const codec = createSessionCodec(SECRET, () => Date.now());
    const originalIssuedAt = START - (30 * 24 * 60 * 60 - 60) * 1000;
    const token = await codec.create({ originalIssuedAt });
    expect((await codec.read(token))?.exp).toBe(START + 60_000);

    vi.setSystemTime(START + 60_001);
    expect(await codec.read(token)).toBeNull();
  });

  it("rejects tampered and expired tokens", async () => {
    const { createSessionCodec } = await import("@/lib/admin/session-codec");
    const codec = createSessionCodec(SECRET, () => Date.now());
    const token = await codec.create();
    const [payload, signature] = token.split(".");
    expect(await codec.read(`${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`)).toBeNull();

    vi.setSystemTime(START + (SESSION_DURATION_SECONDS + 1) * 1000);
    expect(await codec.read(token)).toBeNull();
  });

  it("accepts a signed legacy token with no credential version as version one", async () => {
    const { createSessionCodec } = await import("@/lib/admin/session-codec");
    const payload = btoa(JSON.stringify({ iat: START, exp: START + 60_000 }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    expect(await createSessionCodec(SECRET, () => Date.now()).read(`${payload}.${signature}`)).toEqual({
      iat: START,
      exp: START + 60_000,
      credentialVersion: 1,
    });
  });
});

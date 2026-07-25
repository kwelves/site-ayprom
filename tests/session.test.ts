import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, getSessionPayload, verifySessionToken } from "@/lib/admin/session";

describe("административная сессия", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = "unit-test-secret-with-more-than-32-bytes";
    vi.useRealTimers();
  });

  it("принимает корректно подписанный токен", async () => {
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
    expect(await getSessionPayload(token)).not.toBeNull();
  });

  it("отклоняет изменённую подпись", async () => {
    const token = await createSessionToken();
    const [payload, signature] = token.split(".");
    const replacement = signature.startsWith("A") ? "B" : "A";
    expect(await verifySessionToken(`${payload}.${replacement}${signature.slice(1)}`)).toBe(false);
  });

  it("отклоняет истёкший токен", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = await createSessionToken();
    vi.setSystemTime(new Date("2026-01-02T01:00:00Z"));
    expect(await verifySessionToken(token)).toBe(false);
  });
});

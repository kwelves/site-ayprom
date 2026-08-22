import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionToken,
  getSessionPayload,
  SESSION_DURATION_SECONDS,
  verifySessionToken,
} from "@/lib/admin/session";

describe("административная сессия", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = "unit-test-secret-with-more-than-32-bytes";
    vi.useRealTimers();
  });

  it("принимает корректно подписанный токен", async () => {
    const token = await createSessionToken();
    expect(await verifySessionToken(token)).toBe(true);
    expect((await getSessionPayload(token))?.credentialVersion).toBe(1);
  });

  it("сохраняет версию учётных данных в подписанной сессии", async () => {
    const token = await createSessionToken({ credentialVersion: 7 });
    expect((await getSessionPayload(token))?.credentialVersion).toBe(7);
  });

  it("отклоняет изменённую подпись", async () => {
    const token = await createSessionToken();
    const [payload, signature] = token.split(".");
    const replacement = signature.startsWith("A") ? "B" : "A";
    expect(await verifySessionToken(`${payload}.${replacement}${signature.slice(1)}`)).toBe(false);
  });

  it("отклоняет истёкший токен", async () => {
    vi.useFakeTimers();
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    vi.setSystemTime(issuedAt);
    const token = await createSessionToken();
    vi.setSystemTime(new Date(issuedAt.getTime() + (SESSION_DURATION_SECONDS + 1) * 1000));
    expect(await verifySessionToken(token)).toBe(false);
  });
});

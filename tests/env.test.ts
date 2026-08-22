import { afterEach, describe, expect, it } from "vitest";
import { requireServerEnv } from "@/lib/env";

const originalSessionSecret = process.env.ADMIN_SESSION_SECRET;

afterEach(() => {
  if (originalSessionSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSessionSecret;
});

describe("server environment security", () => {
  it("rejects a documented placeholder", () => {
    process.env.ADMIN_SESSION_SECRET = "replace-with-at-least-32-random-bytes";
    expect(() => requireServerEnv("ADMIN_SESSION_SECRET")).toThrow(/ADMIN_SESSION_SECRET небезопасна/);
  });

  it("rejects a short signing secret", () => {
    process.env.ADMIN_SESSION_SECRET = "too-short";
    expect(() => requireServerEnv("ADMIN_SESSION_SECRET")).toThrow(/не менее 32 байт/);
  });

  it("accepts a sufficiently long non-placeholder secret", () => {
    process.env.ADMIN_SESSION_SECRET = "unit-test-secret-with-more-than-32-bytes";
    expect(requireServerEnv("ADMIN_SESSION_SECRET")).toBe(process.env.ADMIN_SESSION_SECRET);
  });
});

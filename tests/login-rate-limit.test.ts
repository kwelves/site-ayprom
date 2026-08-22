import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, captureMessageMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  captureMessageMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.10" }),
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: captureMessageMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));

import {
  AdminLoginProtectionUnavailableError,
  registerLoginAttempt,
} from "@/lib/admin/login-rate-limit";

describe("admin login rate limit", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = "unit-test-secret-with-more-than-32-bytes";
    rpcMock.mockReset();
    captureMessageMock.mockReset();
  });

  it("passes the attempt scope to the distributed RPC", async () => {
    rpcMock.mockResolvedValue({ data: 0, error: null });

    await expect(registerLoginAttempt(false, "password-change")).resolves.toBe(0);
    expect(rpcMock).toHaveBeenCalledWith(
      "register_admin_login_attempt",
      expect.objectContaining({ password_is_valid: false, attempt_scope: "password-change" }),
    );
  });

  it("fails closed when the distributed guard is unavailable", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "function is missing" },
    });

    await expect(registerLoginAttempt(false)).rejects.toBeInstanceOf(AdminLoginProtectionUnavailableError);
    expect(captureMessageMock).toHaveBeenCalledOnce();
  });
});

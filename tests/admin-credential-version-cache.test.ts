import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAdminCredentialVersion,
  invalidateAdminCredentialVersionCache,
} from "@/lib/admin/credentials";

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}));

beforeEach(() => {
  mocks.maybeSingle.mockReset();
  mocks.maybeSingle.mockResolvedValue({
    data: { password_hash: "hash", session_version: 7 },
    error: null,
  });
  invalidateAdminCredentialVersionCache();
});

describe("admin credential version cache", () => {
  it("не повторяет сетевую проверку для соседних навигационных запросов", async () => {
    const [first, second] = await Promise.all([getAdminCredentialVersion(), getAdminCredentialVersion()]);

    expect(first).toBe(7);
    expect(second).toBe(7);
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("снова проверяет базу после явной инвалидации", async () => {
    await getAdminCredentialVersion();
    invalidateAdminCredentialVersionCache();
    await getAdminCredentialVersion();

    expect(mocks.maybeSingle).toHaveBeenCalledTimes(2);
  });
});

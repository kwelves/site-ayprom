import { describe, expect, it, vi } from "vitest";
import {
  disableCredentialRequestSharing,
  getAdminCredentialVersion,
  invalidateAdminCredentialVersionCache,
} from "@/lib/admin/credentials";

const mocks = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }) }),
}));

// Separate file: turning the sharing off is a one-way switch for the whole module.
describe("credential version without sharing unfinished requests (Cloudflare admin)", () => {
  it("never waits on another request's unfinished database call", async () => {
    disableCredentialRequestSharing();
    invalidateAdminCredentialVersionCache();
    // The first request's database call never finishes (its request was cancelled).
    mocks.maybeSingle.mockReturnValueOnce(new Promise(() => undefined));
    void getAdminCredentialVersion();

    mocks.maybeSingle.mockResolvedValueOnce({ data: { password_hash: "hash", session_version: 9 }, error: null });
    await expect(getAdminCredentialVersion()).resolves.toBe(9);
  });

  it("still caches the finished number for a short time", async () => {
    invalidateAdminCredentialVersionCache();
    mocks.maybeSingle.mockReset();
    mocks.maybeSingle.mockResolvedValue({ data: { password_hash: "hash", session_version: 4 }, error: null });
    await getAdminCredentialVersion();
    await getAdminCredentialVersion();
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
  });
});

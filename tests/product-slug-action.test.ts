import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, session, revalidate } = vi.hoisted(() => ({
  rpc: vi.fn(), session: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => {
  throw Object.assign(new Error(href), { digest: "NEXT_REDIRECT;" });
} }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate, refresh: vi.fn() }));
vi.mock("@/lib/admin/session", () => ({ getSessionPayload: session, SESSION_COOKIE_NAME: "admin_session" }));
vi.mock("@/lib/admin/credentials", () => ({ getAdminCredentialVersion: async () => 1 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/admin/queries", () => ({ getAdminProductTargetPage: async () => 1 }));

import { updateProduct } from "@/lib/admin/actions";

function form(slug: string) {
  const data = new FormData();
  data.set("name", "Pump");
  data.set("categorySlug", "pumps");
  data.set("slug", slug);
  data.set("expectedUpdatedAt", "2026-01-01T00:00:00.123456Z");
  return data;
}

describe("product slug server action", () => {
  beforeEach(() => {
    session.mockResolvedValue({ credentialVersion: 1 });
    rpc.mockReturnValue({ single: async () => ({ error: null }) });
  });

  it("saves the original lookup slug and normalized replacement together, then redirects to the new slug", async () => {
    await expect(updateProduct("old-pump", null, form("New Pump"))).rejects.toThrow("new-pump");
    expect(rpc).toHaveBeenCalledWith("update_product_with_slug", expect.objectContaining({
      p_slug: "old-pump", p_new_slug: "new-pump", p_expected_updated_at: "2026-01-01T00:00:00.123456Z",
    }));
    expect(revalidate).toHaveBeenCalledWith("/admin/products/old-pump/edit");
    expect(revalidate).toHaveBeenCalledWith("/admin/products/new-pump/edit");
  });

  it("keeps a duplicate slug error in the form without navigating", async () => {
    rpc.mockReturnValue({ single: async () => ({ error: { code: "22023", message: "Этот адрес уже занят другим товаром. Укажите другой slug." } }) });
    expect(await updateProduct("old-pump", null, form("taken"))).toEqual({ error: "Этот адрес уже занят другим товаром. Укажите другой slug." });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated edits before database access", async () => {
    session.mockResolvedValue(null);
    await expect(updateProduct("old-pump", null, form("new"))).rejects.toThrow("/admin/login");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects empty addresses before database access", async () => {
    expect(await updateProduct("old-pump", null, form(""))).toMatchObject({ error: expect.stringContaining("Укажите адрес товара") });
    expect(rpc).not.toHaveBeenCalled();
  });
});

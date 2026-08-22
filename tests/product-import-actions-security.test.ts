import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, requireAdminSessionMock, revalidatePathMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  requireAdminSessionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

const referenceRows: Record<string, unknown[]> = {
  categories: [{ slug: "hydraulic-pumps" }],
  subcategories: [],
  brands: [],
  vehicle_types: [],
  products: [],
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/actions", () => ({ requireAdminSession: requireAdminSessionMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: async () => ({ data: referenceRows[table] ?? [], error: null }),
    }),
    rpc: rpcMock,
  }),
}));

import { commitProductImport } from "@/lib/admin/product-import-actions";

describe("product import commit boundary", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    requireAdminSessionMock.mockReset();
    revalidatePathMock.mockReset();
    rpcMock.mockResolvedValue({
      data: [{ row_index: 0, slug: "secure-product", action: "created", error_message: null }],
      error: null,
    });
  });

  it("reparses the uploaded CSV on the server before calling the RPC", async () => {
    const csv = [
      "name,category,short_description",
      "Secure product,hydraulic-pumps,Validated on commit",
    ].join("\n");
    const formData = new FormData();
    formData.set("file", new File([csv], "products.csv", { type: "text/csv" }));

    await expect(commitProductImport(formData)).resolves.toMatchObject({ created: 1, updated: 0 });
    expect(requireAdminSessionMock).toHaveBeenCalledOnce();
    expect(rpcMock).toHaveBeenCalledWith(
      "import_products_batch",
      expect.objectContaining({
        rows: [expect.objectContaining({ name: "Secure product", category_slug: "hydraulic-pumps" })],
      }),
    );
  });

  it("rejects a direct commit without the original file", async () => {
    await expect(commitProductImport(new FormData())).rejects.toThrow("Выберите CSV-файл");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

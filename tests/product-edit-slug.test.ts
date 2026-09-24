import { describe, expect, it } from "vitest";
import { resolveProductEditSlug } from "@/lib/admin/product-edit-slug";

describe("resolveProductEditSlug", () => {
  it("keeps the address when an older form did not submit a slug", () => {
    expect(resolveProductEditSlug(null, "original")).toBe("original");
  });
  it("normalizes an explicitly entered address", () => {
    expect(resolveProductEditSlug("  New Pump 42 ", "original")).toBe("new-pump-42");
  });
  it.each(["", "   ", "!!!", "/"])("rejects unusable address %j instead of renaming from the title", (value) => {
    expect(() => resolveProductEditSlug(value, "original")).toThrow("Укажите адрес товара");
  });
});

import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/admin/slugify";

describe("slugify", () => {
  it("транслитерирует кириллицу и очищает разделители", () => {
    expect(slugify("Гидравлический насос 110!")).toBe("gidravlicheskiy-nasos-110");
  });

  it("не оставляет дефисы по краям", () => {
    expect(slugify("  PTO / Вал  ")).toBe("pto-val");
  });
});

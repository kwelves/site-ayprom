import { describe, expect, it } from "vitest";
import { normalizeSearchQuery } from "@/lib/normalize-search";

describe("normalizeSearchQuery", () => {
  it("нормализует регистр, пунктуацию и пробелы", () => {
    expect(normalizeSearchQuery("  Насос, HOWO / 110-А  ")).toBe("насос howo 110 а");
  });

  it("сохраняет буквы и цифры разных алфавитов", () => {
    expect(normalizeSearchQuery("ZF КПП 16S-151")).toBe("zf кпп 16s 151");
  });
});

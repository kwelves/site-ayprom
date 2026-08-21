import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const brandsList = readFileSync(
  fileURLToPath(new URL("../src/components/admin/BrandsList.tsx", import.meta.url)),
  "utf8",
);

describe("мобильная строка бренда", () => {
  it("размещает редактирование и удаление в одной полноширинной строке", () => {
    expect(brandsList).toContain("contents md:block md:min-w-0 md:flex-1");
    expect(brandsList).toContain("col-span-2 grid grid-cols-2 gap-2");
    expect(brandsList).toContain("flex min-h-11 items-center justify-center");
  });
});

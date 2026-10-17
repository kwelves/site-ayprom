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
    // Both actions are design-system buttons with a 44px touch height below md.
    expect(brandsList).toMatch(/buttonClassName\(\{ variant: "soft", size: "sm", className: "min-h-11 md:min-h-0" \}\)/);
    expect(brandsList).toMatch(/className: "text-danger hover:bg-danger-surface hover:text-danger min-h-11 md:min-h-0"/);
  });
});

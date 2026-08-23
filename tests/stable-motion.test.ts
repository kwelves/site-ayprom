import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const header = readFileSync("src/components/layout/Header.tsx", "utf8");
const productsList = readFileSync("src/components/admin/ProductsList.tsx", "utf8");

describe("stable state transitions", () => {
  it("keeps the mobile header and accordions mounted without height:auto animation", () => {
    expect(header).not.toContain('height: "auto"');
    expect(header).not.toContain("AnimatePresence");
    expect(header).toContain("transition-[grid-template-rows]");
    expect(header).toContain("grid-rows-[0fr]");
    expect(header).toContain("grid-rows-[1fr]");
  });

  it("crossfades persistent menu icons instead of waiting on an empty frame", () => {
    expect(header).toContain('className="relative flex h-6 w-6"');
    expect(header).toContain('open ? "-rotate-90 opacity-0" : "rotate-0 opacity-100"');
    expect(header).toContain('open ? "rotate-0 opacity-100" : "rotate-90 opacity-0"');
  });

  it("keeps both publication labels in one grid cell so the button width cannot jump", () => {
    expect(productsList).not.toContain('AnimatePresence mode="wait"');
    expect(productsList).toContain('<span className="grid" aria-hidden="true">');
    expect(productsList.match(/col-start-1 row-start-1/g)).toHaveLength(2);
  });
});

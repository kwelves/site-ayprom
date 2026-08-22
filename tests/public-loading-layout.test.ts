import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public route loading layout", () => {
  it("keeps the shared footer below the viewport while route content streams", () => {
    const loading = readFileSync("src/app/(site)/loading.tsx", "utf8");

    expect(loading).toContain('className="min-h-[calc(100svh-4rem)]"');
    expect(loading).toContain('className="fixed inset-0');
  });
});

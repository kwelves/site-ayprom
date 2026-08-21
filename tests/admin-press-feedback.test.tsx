import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AdminLayout from "@/app/admin/layout";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "mock-geist" }),
}));

const css = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8");

describe("мобильная обратная связь админки", () => {
  it("ограничивает общий press-feedback корнем админки", () => {
    const markup = renderToStaticMarkup(
      <AdminLayout>
        <main>Админка</main>
      </AdminLayout>,
    );

    expect(markup).toContain("data-admin-root");
    expect(css).toContain("[data-admin-root]");
  });

  it("включается в мобильном layout и на coarse pointer", () => {
    expect(css).toContain('@media (max-width: 63.999rem), (hover: none) and (pointer: coarse)');
    expect(css).toContain("--admin-press-scale: 0.97");
    expect(css).toContain("filter: brightness(0.92)");
  });

  it("охватывает кнопки и ссылки, но исключает недоступные действия", () => {
    expect(css).toContain("button:not(:disabled)");
    expect(css).toContain('a[href]:not([aria-disabled="true"])');
    expect(css).toContain('[role="button"]:not([aria-disabled="true"])');
    expect(css).toContain('input:is([type="button"], [type="submit"], [type="reset"]):not(:disabled)');
  });

  it("убирает сжатие при reduced motion и для drag-handle", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?--admin-press-scale: 1/);
    expect(css).toContain('[data-admin-press-feedback="tone-only"]:active');
  });
});

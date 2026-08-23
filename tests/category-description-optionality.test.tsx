/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryForm } from "@/components/admin/CategoryForm";

vi.mock("@/lib/admin/actions", () => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  replaceCategoryImage: vi.fn(),
}));

afterEach(cleanup);

describe("optional category description", () => {
  it("не требует описание в форме создания", () => {
    render(<CategoryForm mode="create" />);

    const description = screen.getByLabelText("Описание для меню и SEO") as HTMLTextAreaElement;
    expect(description.required).toBe(false);
    expect(screen.getByText(/Необязательно\. Если оставить пустым/)).toBeTruthy();
  });

  it("серверная проверка требует только название", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "lib", "admin", "actions.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(source).toContain('if (!name) {\n    throw new Error("Заполните обязательное поле: название.");');
    expect(source).not.toContain("if (!name || !description)");
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSettingsMenu } from "@/components/admin/AdminSettingsMenu";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/lib/admin/actions", () => ({ logout: vi.fn() }));

afterEach(cleanup);

describe("меню настроек админки", () => {
  it("прячет тему, смену пароля и выход, пока панель закрыта", () => {
    render(<AdminSettingsMenu />);

    expect(screen.getByRole("button", { name: "Настройки" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Сменить пароль")).toBeNull();
    expect(screen.queryByTestId("admin-logout")).toBeNull();
  });

  it("собирает в панели смену темы, смену пароля и выход", () => {
    render(<AdminSettingsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Настройки" }));

    expect(screen.getByRole("button", { name: "Тёмная тема" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Сменить пароль" }).getAttribute("href")).toBe("/admin/security");
    expect(screen.getByTestId("admin-logout").querySelector("button")?.textContent).toBe("Выйти");
  });

  it("закрывается по Escape и по клику вне панели", () => {
    render(
      <div>
        <span>Вне меню</span>
        <AdminSettingsMenu />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Настройки" });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Сменить пароль")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText("Вне меню"));
    expect(screen.queryByText("Сменить пароль")).toBeNull();
  });
});

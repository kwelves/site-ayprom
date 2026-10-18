// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordChangeForm } from "@/components/admin/PasswordChangeForm";
import { NAV_ITEMS } from "@/components/admin/AdminNav";
import { PASSWORD_PATH } from "@/components/admin/AdminSettingsMenu";

vi.mock("@/lib/admin/actions", () => ({
  changeAdminPassword: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/security",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("смена пароля администратора", () => {
  it("открывается из меню настроек, а не отдельной вкладкой навигации", () => {
    expect(NAV_ITEMS.some((item) => item.href === "/admin/security")).toBe(false);
    expect(PASSWORD_PATH).toBe("/admin/security");
  });

  it("показывает три защищённых поля и предупреждение о завершении сессий", () => {
    render(<PasswordChangeForm />);

    expect(screen.getByLabelText("Текущий пароль").getAttribute("autocomplete")).toBe("current-password");
    expect(screen.getByLabelText("Новый пароль").getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByLabelText("Повторите новый пароль").getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByText(/все активные сессии завершатся/i)).toBeTruthy();
  });

  it("отправляет форму по Enter через requestSubmit", () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => undefined);
    render(<PasswordChangeForm />);

    fireEvent.keyDown(screen.getByLabelText("Повторите новый пароль"), { key: "Enter" });

    expect(requestSubmit).toHaveBeenCalledOnce();
  });
});

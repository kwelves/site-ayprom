/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminToastProvider, useAdminToast } from "@/components/admin/ui/AdminToastProvider";

function ToastTriggers() {
  const { success, error } = useAdminToast();

  return (
    <>
      <button type="button" onClick={() => success("Товар успешно удалён")}>
        Успех
      </button>
      <button type="button" onClick={() => error("Не удалось удалить товар")}>
        Ошибка
      </button>
    </>
  );
}

afterEach(cleanup);

describe("AdminToastProvider", () => {
  it("показывает единое успешное уведомление и позволяет его закрыть", () => {
    render(
      <AdminToastProvider>
        <ToastTriggers />
      </AdminToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Успех" }));
    expect(screen.getByRole("status").textContent).toContain("Товар успешно удалён");

    fireEvent.click(screen.getByRole("button", { name: "Закрыть уведомление" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("заменяет предыдущее уведомление сообщением об ошибке", () => {
    render(
      <AdminToastProvider>
        <ToastTriggers />
      </AdminToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Успех" }));
    fireEvent.click(screen.getByRole("button", { name: "Ошибка" }));

    expect(screen.queryByText("Товар успешно удалён")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Не удалось удалить товар");
  });
});

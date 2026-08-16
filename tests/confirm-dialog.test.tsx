// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/admin/ui/ConfirmDialog";

afterEach(cleanup);

function renderDialog(overrides: Partial<ComponentProps<typeof ConfirmDialog>> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const result = render(
    <>
      <button type="button">Открыть</button>
      <ConfirmDialog
        open
        title="Подтвердить действие?"
        description="Изменение будет применено."
        cancelLabel="Отмена"
        confirmLabel="Подтвердить"
        onCancel={onCancel}
        onConfirm={onConfirm}
        {...overrides}
      />
    </>,
  );
  return { ...result, onCancel, onConfirm };
}

describe("ConfirmDialog", () => {
  it("даёт имя alertdialog и переводит начальный фокус на отмену", () => {
    renderDialog();

    expect(screen.getByRole("alertdialog", { name: "Подтвердить действие?" }).getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Отмена" }));
  });

  it("зацикливает Tab и Shift+Tab между действиями", () => {
    renderDialog();
    const dialog = screen.getByRole("alertdialog");
    const cancel = screen.getByRole("button", { name: "Отмена" });
    const confirm = screen.getByRole("button", { name: "Подтвердить" });

    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    cancel.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("вызывает отмену по Escape и подтверждает только явным действием", async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();
    const dialog = screen.getByRole("alertdialog");

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Подтвердить" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("возвращает фокус к вызвавшему элементу после закрытия", () => {
    const view = render(
      <>
        <button type="button">Открыть</button>
        <ConfirmDialog
          open={false}
          title="Подтвердить действие?"
          description="Изменение будет применено."
          cancelLabel="Отмена"
          confirmLabel="Подтвердить"
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Открыть" });
    trigger.focus();

    view.rerender(
      <>
        <button type="button">Открыть</button>
        <ConfirmDialog
          open
          title="Подтвердить действие?"
          description="Изменение будет применено."
          cancelLabel="Отмена"
          confirmLabel="Подтвердить"
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Отмена" }));

    view.rerender(
      <>
        <button type="button">Открыть</button>
        <ConfirmDialog
          open={false}
          title="Подтвердить действие?"
          description="Изменение будет применено."
          cancelLabel="Отмена"
          confirmLabel="Подтвердить"
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </>,
    );

    expect(document.activeElement).toBe(trigger);
  });
});

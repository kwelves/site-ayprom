// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BulkActionBar } from "@/components/admin/ui/BulkActionBar";

afterEach(cleanup);

function renderBulkActionBar() {
  const onClear = vi.fn();
  const onPublish = vi.fn();
  const result = render(
    <BulkActionBar
      count={4}
      itemLabel={(count) => `Выбрано: ${count}`}
      onClear={onClear}
      groups={[
        {
          label: "Публикация",
          mobileClassName: "grid-cols-2",
          actions: (
            <button type="button" onClick={onPublish}>
              Опубликовать
            </button>
          ),
        },
        {
          label: "Наличие",
          mobileClassName: "grid-cols-3",
          actions: <button type="button">В наличии</button>,
        },
      ]}
    />,
  );
  return { ...result, onClear, onPublish };
}

describe("BulkActionBar", () => {
  it("открывает мобильную шторку с группами действий и переводит в неё фокус", async () => {
    const user = userEvent.setup();
    const { onPublish } = renderBulkActionBar();
    const trigger = screen.getByRole("button", { name: "Изменить" });

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Массовое изменение" });
    expect(within(dialog).getByText("Выбрано: 4")).toBeTruthy();
    expect(within(dialog).getByRole("region", { name: "Публикация" })).toBeTruthy();
    expect(within(dialog).getByRole("region", { name: "Наличие" })).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Закрыть массовое изменение" }));

    await user.click(within(dialog).getByRole("button", { name: "Опубликовать" }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("закрывает шторку по Escape, возвращает фокус и не снимает выделение", async () => {
    const user = userEvent.setup();
    const { onClear } = renderBulkActionBar();
    const trigger = screen.getByRole("button", { name: "Изменить" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Массовое изменение" });

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Массовое изменение" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onClear).not.toHaveBeenCalled();
  });

  it("сохраняет быстрый Escape для снятия выделения, когда шторка закрыта", () => {
    const { onClear } = renderBulkActionBar();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

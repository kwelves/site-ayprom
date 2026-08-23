/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductActionsButton, ProductActionsPanel } from "@/components/admin/ProductActionsPanel";
import type { AdminProductHotspotOption, AdminProductListItem } from "@/lib/admin/queries";

vi.mock("@/components/admin/VehicleHotspotPreview", () => ({
  VehicleHotspotPreview: ({ vehicleTypeSlug }: { vehicleTypeSlug: string }) => (
    <div data-testid="vehicle-preview">{vehicleTypeSlug}</div>
  ),
}));

const product: AdminProductListItem = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "test-product",
  name: "Очень длинное название тестового товара для мобильной карточки",
  categoryName: "Категория",
  article: "ART-42",
  shortDescription: "Описание",
  published: true,
  availability: "in_stock",
  hotspotCount: 0,
  order: 0,
  updatedAt: "2026-08-22T00:00:00.000Z",
  coverImage: null,
};

const hotspots: AdminProductHotspotOption[] = [
  {
    id: "00000000-0000-4000-8000-000000000010",
    vehicleTypeSlug: "dump-truck",
    vehicleTypeName: "Самосвал",
    vehicleTypeOrder: 0,
    hotspotNumber: 1,
    label: "Кузов",
    xPct: 40,
    yPct: 50,
    product: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000011",
    vehicleTypeSlug: "dump-truck",
    vehicleTypeName: "Самосвал",
    vehicleTypeOrder: 0,
    hotspotNumber: 2,
    label: "Колесо",
    xPct: 60,
    yPct: 70,
    product: {
      id: "00000000-0000-4000-8000-000000000002",
      slug: "occupied-product",
      name: "Другой товар",
    },
  },
];

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("ProductActionsPanel", () => {
  it("даёт кнопке меню touch-зону 44x44 и доступное имя", () => {
    render(<ProductActionsButton product={product} onOpen={vi.fn()} />);
    const button = screen.getByRole("button", { name: `Открыть действия с товаром «${product.name}»` });
    expect(button.className).toContain("h-11");
    expect(button.className).toContain("w-11");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("блокирует фон, закрывается по Escape и возвращает фокус", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Триггер</button>
        <ProductActionsPanel
          open={false}
          product={product}
          hotspots={hotspots}
          pending={false}
          onClose={onClose}
          onAssign={vi.fn()}
          onDetach={vi.fn()}
        />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Триггер" });
    trigger.focus();
    rerender(
      <>
        <button type="button">Триггер</button>
        <ProductActionsPanel
          open
          product={product}
          hotspots={hotspots}
          pending={false}
          onClose={onClose}
          onAssign={vi.fn()}
          onDetach={vi.fn()}
        />
      </>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Закрыть действия с товаром" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <>
        <button type="button">Триггер</button>
        <ProductActionsPanel
          open={false}
          product={product}
          hotspots={hotspots}
          pending={false}
          onClose={onClose}
          onAssign={vi.fn()}
          onDetach={vi.fn()}
        />
      </>,
    );
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("показывает preview, свободные и занятые точки и подтверждает замену внутри панели", () => {
    const onAssign = vi.fn();
    render(
      <ProductActionsPanel
        open
        product={product}
        hotspots={hotspots}
        pending={false}
        onClose={vi.fn()}
        onAssign={onAssign}
        onDetach={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Закрепить за хотспотом" }));
    expect(screen.getByTestId("vehicle-preview").textContent).toBe("dump-truck");
    expect(screen.getByText("Свободно")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Колесо/ }));
    expect(screen.getByText(/Точка занята товаром «Другой товар»/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Заменить товар" }));
    expect(onAssign).toHaveBeenCalledWith(hotspots[1]);
  });

  it("держит клавиатурный фокус внутри dialog при переходах actions и picker", () => {
    render(
      <ProductActionsPanel
        open
        product={product}
        hotspots={hotspots}
        pending={false}
        onClose={vi.fn()}
        onAssign={vi.fn()}
        onDetach={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const assignment = screen.getByRole("button", { name: "Закрепить за хотспотом" });
    assignment.focus();
    fireEvent.click(assignment);
    const back = screen.getByRole("button", { name: "Вернуться к быстрым действиям" });
    expect(document.activeElement).toBe(back);
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(back);
    const returnedAssignment = screen.getByRole("button", { name: "Закрепить за хотспотом" });
    expect(document.activeElement).toBe(returnedAssignment);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("переводит фокус на стабильный заголовок, если detach размонтировал активную кнопку", () => {
    const assignedProduct = { ...product, hotspotCount: 1 };
    const assignedHotspots = [
      { ...hotspots[0], product: { id: product.id, slug: product.slug, name: product.name } },
    ];
    const view = render(
      <ProductActionsPanel
        open
        product={assignedProduct}
        hotspots={assignedHotspots}
        pending={false}
        onClose={vi.fn()}
        onAssign={vi.fn()}
        onDetach={vi.fn()}
      />,
    );
    const detach = screen.getByRole("button", { name: /Снять с хотспота/ });
    detach.focus();
    view.rerender(
      <ProductActionsPanel
        open
        product={{ ...product, hotspotCount: 0 }}
        hotspots={[{ ...hotspots[0], product: null }]}
        pending
        onClose={vi.fn()}
        onAssign={vi.fn()}
        onDetach={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Действия с товаром" }));
  });

  it("удерживает фокус в picker, если optimistic assign размонтировал footer-кнопку", () => {
    const view = render(
      <ProductActionsPanel
        open
        product={product}
        hotspots={[hotspots[0]]}
        pending={false}
        onClose={vi.fn()}
        onAssign={vi.fn()}
        onDetach={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Закрепить за хотспотом" }));
    fireEvent.click(screen.getByRole("button", { name: /Кузов/ }));
    const submit = screen.getByRole("button", { name: "Закрепить" });
    submit.focus();
    view.rerender(
      <ProductActionsPanel
        open
        product={{ ...product, hotspotCount: 1 }}
        hotspots={[{ ...hotspots[0], product: { id: product.id, slug: product.slug, name: product.name } }]}
        pending
        onClose={vi.fn()}
        onAssign={vi.fn()}
        onDetach={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Выбрать хотспот" }));
  });

  it("не предлагает закрепление черновику и скрывает копирование без артикула", () => {
    render(
      <ProductActionsPanel
        open
        product={{ ...product, published: false, article: undefined }}
        hotspots={hotspots}
        pending={false}
        onClose={vi.fn()}
        onAssign={vi.fn()}
        onDetach={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "Закрепить за хотспотом" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Сначала опубликуйте товар.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Скопировать артикул" })).toBeNull();
  });

  it("показывает несколько привязок и снимает выбранную точку", () => {
    const onDetach = vi.fn();
    const assignedHotspots = hotspots.map((hotspot) => ({
      ...hotspot,
      product: { id: product.id, slug: product.slug, name: product.name },
    }));
    render(
      <ProductActionsPanel
        open
        product={{ ...product, hotspotCount: 2 }}
        hotspots={assignedHotspots}
        pending={false}
        onClose={vi.fn()}
        onAssign={vi.fn()}
        onDetach={onDetach}
      />,
    );

    expect(screen.getByText("Используется в 2 хотспотах")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Добавить ещё один хотспот" })).toBeTruthy();
    const detachButtons = screen.getAllByRole("button", { name: /Снять с хотспота/ });
    fireEvent.click(detachButtons[1]);
    expect(onDetach).toHaveBeenCalledWith(assignedHotspots[1]);
  });

  it("показывает пустое состояние без настроенных хотспотов", () => {
    render(
      <ProductActionsPanel
        open
        product={product}
        hotspots={[]}
        pending={false}
        onClose={vi.fn()}
        onAssign={vi.fn()}
        onDetach={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Закрепить за хотспотом" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Настроенных хотспотов пока нет.")).toBeTruthy();
  });

  it("сообщает об успешном и неуспешном копировании артикула", async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Clipboard denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(
      <ProductActionsPanel
        open
        product={product}
        hotspots={hotspots}
        pending={false}
        onClose={vi.fn()}
        onAssign={vi.fn()}
        onDetach={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Скопировать артикул" }));
    await waitFor(() => expect(screen.getByText("Артикул скопирован")).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith("ART-42");

    fireEvent.click(screen.getByRole("button", { name: "Скопировать артикул" }));
    await waitFor(() => expect(screen.getByText("Не удалось скопировать артикул")).toBeTruthy());
  });
});

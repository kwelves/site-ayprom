/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductsList } from "@/components/admin/ProductsList";
import type { AdminProductHotspotOption, AdminProductListItem } from "@/lib/admin/queries";

const actionMocks = vi.hoisted(() => ({
  reorderProducts: vi.fn(),
  deleteProduct: vi.fn(),
  toggleProductPublished: vi.fn(),
  toggleProductAvailability: vi.fn(),
  bulkUpdateProducts: vi.fn(),
  updateProductHotspotAssignments: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/products",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/admin/actions", () => actionMocks);

vi.mock("@/components/admin/SortableList", () => ({
  SortableList: <T,>({ items, renderItem }: { items: T[]; renderItem: (item: T) => React.ReactNode }) => (
    <div>{items.map((item, index) => <div key={index}>{renderItem(item)}</div>)}</div>
  ),
}));

vi.mock("@/components/admin/VehicleHotspotPreview", () => ({
  VehicleHotspotPreview: () => <div data-testid="vehicle-preview" />,
}));

function assignedProduct(index: number): AdminProductListItem {
  return {
    id: `00000000-0000-4000-8000-00000000000${index}`,
    slug: `product-${index}`,
    name: `Товар ${index}`,
    categoryName: "Категория",
    article: `ART-${index}`,
    shortDescription: "Описание",
    published: true,
    availability: "in_stock",
    hotspotCount: 1,
    order: index,
    updatedAt: "2026-08-22T00:00:00.000Z",
    coverImage: null,
  };
}

function option(product: AdminProductListItem): AdminProductHotspotOption {
  const index = Number(product.slug.split("-").at(-1));
  return hotspotOption(index, product);
}

function unassignedProduct(index: number): AdminProductListItem {
  return { ...assignedProduct(index), hotspotCount: 0 };
}

function hotspotOption(index: number, assigned: AdminProductListItem | null = null): AdminProductHotspotOption {
  return {
    id: `00000000-0000-4000-8000-00000000001${index}`,
    vehicleTypeSlug: "dump-truck",
    vehicleTypeName: "Самосвал",
    vehicleTypeOrder: 0,
    hotspotNumber: index,
    label: `Точка ${index}`,
    xPct: 30 + index * 10,
    yPct: 50,
    product: assigned ? { id: assigned.id, slug: assigned.slug, name: assigned.name } : null,
  };
}

beforeEach(() => {
  actionMocks.toggleProductPublished.mockResolvedValue(undefined);
  actionMocks.bulkUpdateProducts.mockResolvedValue(undefined);
  actionMocks.updateProductHotspotAssignments.mockResolvedValue({ success: true, savedUpdates: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("ProductsList publication and hotspot state", () => {
  it("успешно удаляет товар из списка без redirect-ошибки и старой карточки", async () => {
    const product = unassignedProduct(1);
    actionMocks.deleteProduct.mockResolvedValueOnce(undefined);
    render(<ProductsList products={[product]} hotspotOptions={[]} reorderDisabled />);

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Удалить" }));

    await waitFor(() => expect(actionMocks.deleteProduct).toHaveBeenCalledWith(product.slug, false));
    expect(screen.queryByRole("button", { name: product.name })).toBeNull();
    expect(screen.queryByText("Не удалось удалить запись. Она возвращена в список.")).toBeNull();
  });

  it("даёт непрерывному длинному названию перенос внутри колонки перед кнопкой меню", () => {
    const name = "Сверхдлинноеназваниетоварабезединогопробелакотороенедолжноперекрыватькнопкудействий";
    const product = { ...unassignedProduct(1), name };
    render(<ProductsList products={[product]} hotspotOptions={[]} reorderDisabled />);

    const title = screen.getByRole("button", { name }).querySelector("p");
    expect(title?.className).toContain("break-words");
    expect(title?.className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByRole("button", { name: `Открыть действия с товаром «${name}»` })).toBeTruthy();
  });

  it("назначает свободную точку одним CAS-изменением и обновляет локальное закрепление", async () => {
    const product = unassignedProduct(1);
    const target = hotspotOption(2);
    render(<ProductsList products={[product]} hotspotOptions={[target]} reorderDisabled />);

    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${product.name}»` }));
    fireEvent.click(screen.getByRole("button", { name: "Закрепить за хотспотом" }));
    fireEvent.click(screen.getByRole("button", { name: /Точка 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Закрепить" }));

    await waitFor(() =>
      expect(actionMocks.updateProductHotspotAssignments).toHaveBeenCalledWith([
        { hotspotId: target.id, expectedProductId: null, productId: product.id },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Выбрать хотспот" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${product.name}»` }));
    expect(screen.getByText("Точка №2")).toBeTruthy();
  });

  it("добавляет товар на вторую точку одним CAS-изменением и сохраняет прежнюю", async () => {
    const product = assignedProduct(1);
    const oldHotspot = option(product);
    const target = hotspotOption(2);
    render(<ProductsList products={[product]} hotspotOptions={[oldHotspot, target]} reorderDisabled />);

    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${product.name}»` }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить ещё один хотспот" }));
    fireEvent.click(screen.getByRole("button", { name: /Точка 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Закрепить" }));

    await waitFor(() =>
      expect(actionMocks.updateProductHotspotAssignments).toHaveBeenCalledWith([
        { hotspotId: target.id, expectedProductId: null, productId: product.id },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Выбрать хотспот" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${product.name}»` }));
    expect(screen.getByText("Используется в 2 хотспотах")).toBeTruthy();
    expect(screen.getByText("Точка №1")).toBeTruthy();
    expect(screen.getByText("Точка №2")).toBeTruthy();
  });

  it("замена занятой точки отвязывает видимый вытесненный товар", async () => {
    const incoming = unassignedProduct(1);
    const displaced = assignedProduct(2);
    const target = option(displaced);
    render(<ProductsList products={[incoming, displaced]} hotspotOptions={[target]} reorderDisabled />);

    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${incoming.name}»` }));
    fireEvent.click(screen.getByRole("button", { name: "Закрепить за хотспотом" }));
    fireEvent.click(screen.getByRole("button", { name: /Точка 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Заменить товар" }));

    await waitFor(() =>
      expect(actionMocks.updateProductHotspotAssignments).toHaveBeenCalledWith([
        { hotspotId: target.id, expectedProductId: displaced.id, productId: incoming.id },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Выбрать хотспот" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${displaced.name}»` }));
    expect(screen.getByText("Товар пока не закреплён за техникой.")).toBeTruthy();
  });

  it("при CAS-конфликте добавления восстанавливает целевую точку и сохраняет прежнюю", async () => {
    const incoming = assignedProduct(1);
    const displaced = assignedProduct(2);
    const oldHotspot = option(incoming);
    const target = option(displaced);
    actionMocks.updateProductHotspotAssignments.mockResolvedValueOnce({ error: "Данные изменены другим администратором" });
    render(<ProductsList products={[incoming, displaced]} hotspotOptions={[oldHotspot, target]} reorderDisabled />);

    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${incoming.name}»` }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить ещё один хотспот" }));
    fireEvent.click(screen.getByRole("button", { name: /Точка 2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Заменить товар" }));

    await waitFor(() => expect(screen.getByText("Данные изменены другим администратором")).toBeTruthy());
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Заменить товар" }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Закрыть действия с товаром" }));
    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${incoming.name}»` }));
    expect(screen.getByText("Точка №1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть действия с товаром" }));
    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${displaced.name}»` }));
    expect(screen.getByText("Точка №2")).toBeTruthy();
  });

  it("Undo закрепления сохраняет более позднее изменение наличия", async () => {
    const product = assignedProduct(1);
    const assignedHotspot = option(product);
    render(<ProductsList products={[product]} hotspotOptions={[assignedHotspot]} reorderDisabled />);

    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${product.name}»` }));
    fireEvent.click(screen.getByRole("button", { name: /Снять с хотспота/ }));

    await waitFor(() =>
      expect(actionMocks.updateProductHotspotAssignments).toHaveBeenCalledWith([
        { hotspotId: assignedHotspot.id, expectedProductId: product.id, productId: null },
      ]),
    );
    expect(await screen.findByText("Товар снят с хотспота")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Отменить" })).not.toBeNull());
    fireEvent.click(screen.getByRole("radio", { name: "Уточнить" }));
    await waitFor(() => expect(actionMocks.toggleProductAvailability).toHaveBeenCalledWith(product.slug, "unclear"));
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await waitFor(() => expect(actionMocks.updateProductHotspotAssignments).toHaveBeenCalledTimes(2));
    expect(actionMocks.updateProductHotspotAssignments).toHaveBeenLastCalledWith([
      { hotspotId: assignedHotspot.id, expectedProductId: null, productId: product.id },
    ]);

    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${product.name}»` }));
    expect(screen.getByText("Самосвал")).toBeTruthy();
    expect(screen.getByText("Точка №1")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Уточнить" }).getAttribute("aria-checked")).toBe("true");
  });

  it("одиночное подтверждённое снятие публикации сразу очищает локальное закрепление", async () => {
    const product = assignedProduct(1);
    render(<ProductsList products={[product]} hotspotOptions={[option(product)]} reorderDisabled />);

    fireEvent.click(screen.getByRole("button", { name: `Переключить публикацию товара «${product.name}»` }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Снять с публикации" }));

    await waitFor(() => expect(actionMocks.toggleProductPublished).toHaveBeenCalledWith(product.slug, false, true));
    expect(screen.getByRole("button", { name: `Переключить публикацию товара «${product.name}»` }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${product.name}»` }));
    expect(screen.getByText("Товар пока не закреплён за техникой.")).toBeTruthy();
  });

  it("при ошибке одиночного снятия публикации восстанавливает публикацию и закрепление", async () => {
    const product = assignedProduct(1);
    actionMocks.toggleProductPublished.mockRejectedValueOnce(new Error("Конфликт состояния"));
    render(<ProductsList products={[product]} hotspotOptions={[option(product)]} reorderDisabled />);

    fireEvent.click(screen.getByRole("button", { name: `Переключить публикацию товара «${product.name}»` }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Снять с публикации" }));

    await waitFor(() => expect(screen.getByText("Конфликт состояния")).toBeTruthy());
    expect(screen.getByRole("button", { name: `Переключить публикацию товара «${product.name}»` }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${product.name}»` }));
    expect(screen.getByText("Самосвал")).toBeTruthy();
    expect(screen.getByText("Точка №1")).toBeTruthy();
  });

  it("массовое подтверждённое снятие публикации синхронно очищает оба закрепления", async () => {
    const first = assignedProduct(1);
    const second = assignedProduct(2);
    render(<ProductsList products={[first, second]} hotspotOptions={[option(first), option(second)]} reorderDisabled />);

    fireEvent.click(screen.getByRole("checkbox", { name: `Выделить товар «${first.name}»` }));
    fireEvent.click(screen.getByRole("checkbox", { name: `Выделить товар «${second.name}»` }));
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    const bulkSheet = screen.getByRole("dialog", { name: "Массовое изменение" });
    fireEvent.click(within(bulkSheet).getByRole("button", { name: "Снять с публикации" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Снять с публикации" }));

    await waitFor(() => expect(actionMocks.bulkUpdateProducts).toHaveBeenCalledWith([first.slug, second.slug], { published: false }));
    for (const product of [first, second]) {
      expect(screen.getByRole("button", { name: `Переключить публикацию товара «${product.name}»` }).getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(screen.getByRole("button", { name: `Открыть действия с товаром «${product.name}»` }));
      expect(screen.getByText("Товар пока не закреплён за техникой.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Закрыть действия с товаром" }));
    }
  });
});

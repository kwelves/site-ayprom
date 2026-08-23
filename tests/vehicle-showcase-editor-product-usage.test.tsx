/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VehicleShowcaseEditor } from "@/components/admin/VehicleShowcaseEditor";
import type { AdminAvailableProduct, AdminVehicleHotspot } from "@/lib/admin/queries";

const actionMocks = vi.hoisted(() => ({
  restoreVehicleHotspots: vi.fn(),
  saveVehicleHotspots: vi.fn(),
  searchAvailableHotspotProducts: vi.fn(),
}));

vi.mock("@/lib/admin/actions", () => actionMocks);

const hotspots: AdminVehicleHotspot[] = Array.from({ length: 5 }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000000001${index + 1}`,
  vehicleTypeSlug: "dump-truck",
  hotspotNumber: index + 1,
  label: `Точка ${index + 1}`,
  xPct: 20 + index * 10,
  yPct: 50,
  product: null,
}));

const usedProduct: AdminAvailableProduct = {
  id: "00000000-0000-4000-8000-000000000099",
  slug: "used-product",
  name: "Гидронасос",
  article: "PUMP-42",
  hotspotAssignments: [
    {
      id: "00000000-0000-4000-8000-000000000091",
      vehicleTypeSlug: "crane",
      vehicleTypeName: "Кран-манипулятор",
      hotspotNumber: 2,
      label: "Гидробак",
    },
    {
      id: "00000000-0000-4000-8000-000000000092",
      vehicleTypeSlug: "garbage-truck",
      vehicleTypeName: "Мусоровоз",
      hotspotNumber: 4,
      label: "Пресс",
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VehicleShowcaseEditor product usage", () => {
  it("показывает все текущие привязки и разрешает повторно выбрать товар", async () => {
    actionMocks.searchAvailableHotspotProducts.mockResolvedValueOnce([usedProduct]);
    render(<VehicleShowcaseEditor vehicleTypeSlug="dump-truck" vehicleTypeName="Самосвал" hotspots={hotspots} />);

    fireEvent.change(screen.getAllByPlaceholderText("Введите название или артикул")[0], {
      target: { value: "насос" },
    });

    await waitFor(() => expect(actionMocks.searchAvailableHotspotProducts).toHaveBeenCalledWith("насос"));
    expect(
      await screen.findByText(
        "Используется: Кран-манипулятор · точка №2 «Гидробак»; Мусоровоз · точка №4 «Пресс»",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Выбрать товар «Гидронасос» для точки 1" }));
    expect(screen.queryByText(/уже выбран для другой точки/)).toBeNull();
    expect(screen.getByText("Гидронасос")).toBeTruthy();
  });
});

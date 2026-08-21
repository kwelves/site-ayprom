// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VehicleShowcaseTabs } from "@/components/admin/VehicleShowcaseTabs";

vi.mock("@/components/admin/VehicleHotspotPreview", () => ({
  VehicleHotspotPreview: ({ vehicleTypeSlug }: { vehicleTypeSlug: string }) => (
    <div data-testid="preview">preview:{vehicleTypeSlug}</div>
  ),
}));

vi.mock("@/components/admin/VehicleShowcaseEditor", () => ({
  VehicleShowcaseEditor: ({ vehicleTypeSlug }: { vehicleTypeSlug: string }) => (
    <div data-testid="editor">editor:{vehicleTypeSlug}</div>
  ),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("VehicleShowcaseTabs", () => {
  it("переключает тип техники локально без ожидания серверной навигации", () => {
    window.history.replaceState(null, "", "/admin/vehicle-showcase?vehicle=loader");

    render(
      <VehicleShowcaseTabs
        vehicleTypes={[
          { slug: "loader", name: "Погрузчик", order: 0, productCount: 1 },
          { slug: "excavator", name: "Экскаватор", order: 1, productCount: 1 },
        ]}
        hotspots={[
          {
            id: "hotspot-loader",
            vehicleTypeSlug: "loader",
            hotspotNumber: 1,
            label: "Loader",
            xPct: 10,
            yPct: 10,
            product: null,
          },
          {
            id: "hotspot-excavator",
            vehicleTypeSlug: "excavator",
            hotspotNumber: 1,
            label: "Excavator",
            xPct: 20,
            yPct: 20,
            product: null,
          },
        ]}
        initialVehicleTypeSlug="loader"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Экскаватор" }));

    expect(screen.getByTestId("preview").textContent).toBe("preview:excavator");
    expect(screen.getByTestId("editor").textContent).toBe("editor:excavator");
    expect(window.location.search).toBe("?vehicle=excavator");
  });
});

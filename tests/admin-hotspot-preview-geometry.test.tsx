// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VehicleHotspotPreview } from "@/components/admin/VehicleHotspotPreview";

vi.mock("next/image", () => ({
  default: (props: React.ComponentProps<"img"> & { unoptimized?: boolean }) => {
    const { unoptimized, alt = "", ...imageProps } = props;
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt} {...imageProps} />;
  },
}));

vi.mock("@/components/home/vehicle-showcase/useContainRect", () => ({
  useContainRect: () => ({ left: 10, top: 20, width: 200, height: 300, boxWidth: 320, boxHeight: 400 }),
}));

afterEach(cleanup);

describe("VehicleHotspotPreview geometry", () => {
  it("рисует изображение и точки в одной contain-системе координат", () => {
    const { container, getByText } = render(
      <VehicleHotspotPreview
        vehicleTypeSlug="kran-manipulyator"
        hotspots={[{ id: "one", hotspotNumber: 1, label: "Стрела", xPct: 25, yPct: 50 }]}
      />,
    );

    const image = container.querySelector("img");
    expect(image?.style.left).toBe("10px");
    expect(image?.style.top).toBe("20px");
    expect(image?.style.width).toBe("200px");
    expect(image?.style.height).toBe("300px");

    const hotspot = getByText("Стрела").parentElement;
    expect(hotspot?.style.left).toBe("60px");
    expect(hotspot?.style.top).toBe("170px");
  });
});

import { describe, expect, it } from "vitest";
import {
  HOTSPOT_ACTIVE_SCALE,
  HOTSPOT_GAP,
  HOTSPOT_HIT_MIN,
  HOTSPOT_VISUAL_MAX,
  HOTSPOT_VISUAL_MIN,
  calculateHotspotLayoutMetrics,
  resolveHotspotPositions,
} from "@/components/home/vehicle-showcase/showcase-layout";

const isolatedPoint = [{ id: "a", x: 0, y: 0 }];

describe("calculateHotspotLayoutMetrics", () => {
  it("clamps the visual diameter while growing smoothly with the rendered image", () => {
    const minimum = calculateHotspotLayoutMetrics(200, isolatedPoint).get("a")!;
    const fluid = calculateHotspotLayoutMetrics(430, isolatedPoint).get("a")!;
    const maximum = calculateHotspotLayoutMetrics(800, isolatedPoint).get("a")!;

    expect(minimum.visualDiameter).toBe(40);
    expect(fluid.visualDiameter).toBe(43);
    expect(maximum.visualDiameter).toBe(HOTSPOT_VISUAL_MAX);
    expect(minimum.visualDiameter).toBeGreaterThanOrEqual(HOTSPOT_VISUAL_MIN);
  });

  it("shrinks close markers and keeps the requested visual clearance at active scale", () => {
    const centerDistance = 55;
    const metrics = calculateHotspotLayoutMetrics(800, [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: centerDistance, y: 0 },
    ]);
    const first = metrics.get("a")!;
    const second = metrics.get("b")!;
    const visibleGap =
      centerDistance - (first.visualDiameter * HOTSPOT_ACTIVE_SCALE) / 2 - second.visualDiameter / 2;

    expect(first.visualDiameter).toBeLessThan(HOTSPOT_VISUAL_MAX);
    expect(first.nearestDistance).toBe(centerDistance);
    expect(visibleGap).toBeGreaterThanOrEqual(HOTSPOT_GAP);
  });

  it("never drops the visual core below 34px or the hit area below 44px", () => {
    const metrics = calculateHotspotLayoutMetrics(120, [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 20, y: 0 },
    ]);

    for (const marker of metrics.values()) {
      expect(marker.visualDiameter).toBe(HOTSPOT_VISUAL_MIN);
      expect(marker.hitArea).toBeGreaterThanOrEqual(HOTSPOT_HIT_MIN);
      expect(marker.iconSize).toBeCloseTo(marker.visualDiameter * 0.42, 3);
    }
  });

  it("minimally separates legacy anchors when the visual minimum cannot provide an 8px gap", () => {
    const points = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 28, y: 0 },
      { id: "c", x: 120, y: 0 },
    ];
    const metrics = calculateHotspotLayoutMetrics(200, points);
    const resolved = resolveHotspotPositions(points, metrics);
    const first = resolved.get("a")!;
    const second = resolved.get("b")!;
    const third = resolved.get("c")!;
    const firstDiameter = metrics.get("a")!.visualDiameter;
    const secondDiameter = metrics.get("b")!.visualDiameter;
    const activeGap =
      Math.hypot(second.x - first.x, second.y - first.y) -
      (firstDiameter * HOTSPOT_ACTIVE_SCALE) / 2 -
      secondDiameter / 2;

    expect(activeGap).toBeGreaterThanOrEqual(HOTSPOT_GAP - 0.001);
    expect(first.anchorX).toBe(0);
    expect(second.anchorX).toBe(28);
    expect(third.x).toBe(third.anchorX);
    expect(third.y).toBe(third.anchorY);
  });
});

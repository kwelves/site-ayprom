import { describe, expect, it } from "vitest";
import {
  buildConnectorPaths,
  buildVerticalConnectorPath,
  type Rect,
} from "@/components/home/vehicle-showcase/connector-geometry";

const hotspotHitRect: Rect = { left: 78, top: 78, width: 44, height: 44 };
const cardRect: Rect = { left: 300, top: 220, width: 360, height: 420 };

function readMove(path: string) {
  const match = /^M ([\d.-]+) ([\d.-]+)/.exec(path);
  if (!match) throw new Error(`Path has no move command: ${path}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe("connector geometry", () => {
  it("starts a desktop connector at the visual circle instead of the larger hit area", () => {
    const visualRadius = 17;
    const paths = buildConnectorPaths(hotspotHitRect, visualRadius, cardRect, []);
    const start = readMove(paths.stem);
    const distanceFromCenter = Math.hypot(start.x - 100, start.y - 100);

    expect(distanceFromCenter).toBeCloseTo(visualRadius + 3, 5);
    expect(distanceFromCenter).toBeLessThan(hotspotHitRect.width / 2 + 3);
  });

  it("uses the visual radius for the stacked connector start", () => {
    const visualRadius = 18;
    const path = buildVerticalConnectorPath(hotspotHitRect, visualRadius, cardRect);

    expect(readMove(path.stem)).toEqual({ x: 100, y: 121 });
  });
});

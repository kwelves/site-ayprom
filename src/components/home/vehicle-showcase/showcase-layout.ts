export const HOTSPOT_VISUAL_MIN = 34;
export const HOTSPOT_VISUAL_MAX = 46;
export const HOTSPOT_HIT_MIN = 44;
export const HOTSPOT_GAP = 8;
export const HOTSPOT_ACTIVE_SCALE = 1.08;
const HOTSPOT_SUBPIXEL_RESERVE = 0.125;

export interface HotspotLayoutPoint {
  id: string;
  x: number;
  y: number;
}

export interface HotspotLayoutMetrics {
  visualDiameter: number;
  hitArea: number;
  iconSize: number;
  pulseSpread: number;
  nearestDistance: number | null;
}

export interface HotspotResolvedPoint extends HotspotLayoutPoint {
  anchorX: number;
  anchorY: number;
}

function clamp(minimum: number, value: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundMetric(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Calculates marker metrics from the rendered vehicle image rather than the
 * viewport. The collision cap includes the active/hover scale, so two nearby
 * markers keep their visual clearance even while one of them grows.
 */
export function calculateHotspotLayoutMetrics(
  imageWidth: number,
  points: HotspotLayoutPoint[],
): Map<string, HotspotLayoutMetrics> {
  const baseDiameter = clamp(40, imageWidth * 0.1, HOTSPOT_VISUAL_MAX);

  return new Map(
    points.map((point, pointIndex) => {
      let nearestDistance = Number.POSITIVE_INFINITY;

      points.forEach((candidate, candidateIndex) => {
        if (candidateIndex === pointIndex) return;
        nearestDistance = Math.min(nearestDistance, Math.hypot(candidate.x - point.x, candidate.y - point.y));
      });

      const collisionMaximum = Number.isFinite(nearestDistance)
        ? (nearestDistance - HOTSPOT_GAP) / HOTSPOT_ACTIVE_SCALE
        : HOTSPOT_VISUAL_MAX;
      const visualDiameter = clamp(
        HOTSPOT_VISUAL_MIN,
        Math.min(baseDiameter, collisionMaximum),
        HOTSPOT_VISUAL_MAX,
      );

      return [
        point.id,
        {
          visualDiameter: roundMetric(visualDiameter),
          hitArea: roundMetric(Math.max(HOTSPOT_HIT_MIN, visualDiameter)),
          iconSize: roundMetric(visualDiameter * 0.42),
          pulseSpread: roundMetric(clamp(6, visualDiameter * 0.18, 9)),
          nearestDistance: Number.isFinite(nearestDistance) ? roundMetric(nearestDistance) : null,
        },
      ];
    }),
  );
}

export function createFallbackHotspotMetrics(): HotspotLayoutMetrics {
  return {
    visualDiameter: 40,
    hitArea: HOTSPOT_HIT_MIN,
    iconSize: 40 * 0.42,
    pulseSpread: 40 * 0.18,
    nearestDistance: null,
  };
}

/**
 * The 34px visual minimum can be wider than the free space between legacy
 * Supabase anchors. In that impossible case, keep those coordinates as the
 * source of truth but minimally separate the rendered centers. Uncrowded
 * markers are returned at their exact anchors.
 */
export function resolveHotspotPositions(
  points: HotspotLayoutPoint[],
  metrics: Map<string, HotspotLayoutMetrics>,
): Map<string, HotspotResolvedPoint> {
  const resolved = points.map((point) => ({ ...point, anchorX: point.x, anchorY: point.y }));

  for (let iteration = 0; iteration < 12; iteration += 1) {
    let moved = false;

    for (let firstIndex = 0; firstIndex < resolved.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < resolved.length; secondIndex += 1) {
        const first = resolved[firstIndex];
        const second = resolved[secondIndex];
        const firstDiameter = metrics.get(first.id)?.visualDiameter ?? HOTSPOT_VISUAL_MIN;
        const secondDiameter = metrics.get(second.id)?.visualDiameter ?? HOTSPOT_VISUAL_MIN;
        const requiredDistance =
          (firstDiameter + secondDiameter) / 2 +
          ((HOTSPOT_ACTIVE_SCALE - 1) * Math.max(firstDiameter, secondDiameter)) / 2 +
          HOTSPOT_GAP +
          HOTSPOT_SUBPIXEL_RESERVE;
        let deltaX = second.x - first.x;
        let deltaY = second.y - first.y;
        let distance = Math.hypot(deltaX, deltaY);

        if (distance >= requiredDistance - 0.001) continue;
        if (distance < 0.001) {
          const angle = ((firstIndex + 1) * 2.399963229728653) % (Math.PI * 2);
          deltaX = Math.cos(angle);
          deltaY = Math.sin(angle);
          distance = 1;
        }

        const correction = (requiredDistance - distance) / 2;
        const unitX = deltaX / distance;
        const unitY = deltaY / distance;
        first.x -= unitX * correction;
        first.y -= unitY * correction;
        second.x += unitX * correction;
        second.y += unitY * correction;
        moved = true;
      }
    }

    if (!moved) break;
  }

  return new Map(
    resolved.map((point) => [
      point.id,
      { ...point, x: roundMetric(point.x), y: roundMetric(point.y) },
    ]),
  );
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ConnectorPaths {
  stem: string;
  topBranch: string;
  bottomBranch: string;
  terminal: { x: number; y: number };
}

const CARD_MARGIN = 100;
const MIN_DIAGONAL = 56;
const CLEARANCE = 34;
// Must match ProductPanel's actual CSS corner radius (rounded-2xl = 1rem =
// 16px) — a mismatch here is what made the traced outline visibly diverge
// from the card's real rounded corner, reading as a second, sharper-edged
// box ghosting behind it.
const CORNER_MAX = 16;
const OBSTACLE_RADIUS = 22;
const Y_CANDIDATES = [76, 116, 46, 156, 26, 196];

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Builds the three connector segments (stem + two branches wrapping the
 * card's right side) per the "printed-circuit trace" spec: Manhattan
 * routing with a candidate-offset search so the stem's horizontal run
 * never passes through another hotspot. All rects are in the same
 * (container-relative) coordinate space.
 */
export function buildConnectorPaths(hotspot: Rect, card: Rect, obstacles: Rect[]): ConnectorPaths {
  const hx = hotspot.left + hotspot.width / 2;
  const hy = hotspot.top + hotspot.height / 2;
  const radius = hotspot.width / 2;
  const cardCenterY = card.top + card.height / 2;
  const sign = cardCenterY >= hy ? 1 : -1;

  const obstacleCenters = obstacles.map((rect) => ({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }));

  const bendX = Math.max(hx + MIN_DIAGONAL, card.left - CARD_MARGIN);

  let endY = hy + sign * Y_CANDIDATES[0];
  for (const offset of Y_CANDIDATES) {
    const candidateY = hy + sign * offset;
    const clearsAll = obstacleCenters.every(
      (obstacle) =>
        distanceToSegment(obstacle.x, obstacle.y, bendX, candidateY, card.left, candidateY) >=
          OBSTACLE_RADIUS + CLEARANCE &&
        distanceToSegment(obstacle.x, obstacle.y, hx, hy, bendX, candidateY) >= OBSTACLE_RADIUS + CLEARANCE,
    );
    if (clearsAll) {
      endY = candidateY;
      break;
    }
  }

  const startAngle = Math.atan2(endY - hy, bendX - hx);
  const startX = hx + (radius + 3) * Math.cos(startAngle);
  const startY = hy + (radius + 3) * Math.sin(startAngle);

  const entryX = card.left;
  const entryY = endY;
  const cornerR = Math.min(CORNER_MAX, card.width / 2, card.height / 2);
  const cardRight = card.left + card.width;
  const cardTop = card.top;
  const cardBottom = card.top + card.height;
  const oppositeY = card.top + card.height - (entryY - card.top);

  const stem = `M ${startX} ${startY} L ${bendX} ${endY} L ${entryX} ${entryY}`;

  const topBranch = `M ${entryX} ${entryY} L ${entryX} ${cardTop + cornerR} Q ${entryX} ${cardTop} ${entryX + cornerR} ${cardTop} L ${cardRight - cornerR} ${cardTop} Q ${cardRight} ${cardTop} ${cardRight} ${cardTop + cornerR} L ${cardRight} ${oppositeY}`;

  const bottomBranch = `M ${entryX} ${entryY} L ${entryX} ${cardBottom - cornerR} Q ${entryX} ${cardBottom} ${entryX + cornerR} ${cardBottom} L ${cardRight - cornerR} ${cardBottom} Q ${cardRight} ${cardBottom} ${cardRight} ${cardBottom - cornerR} L ${cardRight} ${oppositeY}`;

  return { stem, topBranch, bottomBranch, terminal: { x: entryX, y: entryY } };
}

/** Simpler top-entry route for the stacked mobile layout, where the card
 * sits full-width below the photo instead of beside it — wrapping around
 * "left/right edges" doesn't apply when there's no side to wrap. */
export function buildVerticalConnectorPath(hotspot: Rect, card: Rect): { stem: string; terminal: { x: number; y: number } } {
  const hx = hotspot.left + hotspot.width / 2;
  const hy = hotspot.top + hotspot.height / 2;
  const radius = hotspot.width / 2;
  const entryX = card.left + card.width / 2;
  const entryY = card.top;
  const bendY = Math.max(hy + radius + 24, entryY - 40);

  const stem = `M ${hx} ${hy + radius + 3} L ${hx} ${bendY} L ${entryX} ${entryY}`;
  return { stem, terminal: { x: entryX, y: entryY } };
}

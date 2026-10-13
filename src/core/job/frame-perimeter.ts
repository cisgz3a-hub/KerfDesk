import type { Vec2 } from '../scene';
import type { FrameStartPoint } from '../scene/start-points';
import type { JobBounds } from './job-bounds';

function frameCorners(bounds: JobBounds): readonly [Vec2, Vec2, Vec2, Vec2] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

/** Same closed perimeter for the canvas and every controller. An interior
 * start splits one edge; it never shortens the rectangle or adds a diagonal. */
export function buildFramePerimeter(
  bounds: JobBounds,
  start: FrameStartPoint = { edge: 0, fraction: 0 },
): readonly [Vec2, ...Vec2[]] {
  const corners = frameCorners(bounds);
  const edge = start.fraction === 1 ? (start.edge + 1) % 4 : start.edge;
  const fraction = start.fraction === 1 ? 0 : start.fraction;
  const from = corners[edge] ?? corners[0];
  const to = corners[(edge + 1) % 4] ?? corners[0];
  const first = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
  const route: [Vec2, ...Vec2[]] = [first];
  for (let step = 1; step <= 4; step += 1) route.push(corners[(edge + step) % 4] ?? corners[0]);
  if (fraction !== 0) route.push(first);
  return route;
}

/** Project onto the closest boundary edge. Corner ties resolve deterministically. */
export function nearestFrameStartPoint(bounds: JobBounds, point: Vec2): FrameStartPoint {
  const corners = frameCorners(bounds);
  let best: FrameStartPoint = { edge: 0, fraction: 0 };
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const edge of [0, 1, 2, 3] as const) {
    const from = corners[edge];
    const to = corners[(edge + 1) % 4] ?? corners[0];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const fraction =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
          );
    const distance =
      (point.x - from.x - dx * fraction) ** 2 + (point.y - from.y - dy * fraction) ** 2;
    if (distance < nearestDistance) {
      best = { edge, fraction };
      nearestDistance = distance;
    }
  }
  return best;
}

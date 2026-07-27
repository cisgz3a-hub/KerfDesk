import type { Vec2 } from '../core/scene';

const DEGENERATE_SEGMENT_EPSILON_SQUARED = 1e-18;

/** Largest point-to-polyline distance, used by geometry regression fixtures. */
export function maximumPointDistanceToPolyline(
  points: ReadonlyArray<Vec2>,
  polyline: ReadonlyArray<Vec2>,
): number {
  return Math.max(...points.map((point) => distanceToPolyline(point, polyline)));
}

function distanceToPolyline(point: Vec2, polyline: ReadonlyArray<Vec2>): number {
  let distance = Infinity;
  for (let index = 1; index < polyline.length; index += 1) {
    const start = polyline[index - 1];
    const end = polyline[index];
    if (start !== undefined && end !== undefined) {
      distance = Math.min(distance, distanceToSegment(point, start, end));
    }
  }
  return distance;
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= DEGENERATE_SEGMENT_EPSILON_SQUARED) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

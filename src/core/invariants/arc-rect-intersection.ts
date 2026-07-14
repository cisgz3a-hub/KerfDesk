import { isAngleOnArc } from './arc-bounds';

type Point = { readonly x: number; readonly y: number };
type Rect = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

const EPSILON = 1e-9;

// Exact circle/rectangle-edge intersection, filtered to the commanded G2/G3
// sweep. This avoids both the unsafe endpoint-chord shortcut and the nuisance
// false positives produced by treating the arc's entire AABB as motion.
export function arcIntersectsRect(
  start: Point,
  end: Point,
  i: number,
  j: number,
  clockwise: boolean,
  rect: Rect,
): boolean {
  if (pointInRect(start, rect) || pointInRect(end, rect)) return true;
  const center = { x: start.x + i, y: start.y + j };
  const radius = Math.hypot(i, j);
  if (radius <= EPSILON) return false;
  const fullCircle = Math.hypot(end.x - start.x, end.y - start.y) <= EPSILON;
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const onSweep = (point: Point): boolean =>
    fullCircle ||
    isAngleOnArc(
      Math.atan2(point.y - center.y, point.x - center.x),
      startAngle,
      endAngle,
      clockwise,
    );

  return (
    verticalEdgeIntersects(rect.minX, rect, center, radius, onSweep) ||
    verticalEdgeIntersects(rect.maxX, rect, center, radius, onSweep) ||
    horizontalEdgeIntersects(rect.minY, rect, center, radius, onSweep) ||
    horizontalEdgeIntersects(rect.maxY, rect, center, radius, onSweep)
  );
}

function verticalEdgeIntersects(
  x: number,
  rect: Rect,
  center: Point,
  radius: number,
  onSweep: (point: Point) => boolean,
): boolean {
  const root = circleRoot(radius, x - center.x);
  if (root === null) return false;
  return [center.y - root, center.y + root].some(
    (y) => y >= rect.minY - EPSILON && y <= rect.maxY + EPSILON && onSweep({ x, y }),
  );
}

function horizontalEdgeIntersects(
  y: number,
  rect: Rect,
  center: Point,
  radius: number,
  onSweep: (point: Point) => boolean,
): boolean {
  const root = circleRoot(radius, y - center.y);
  if (root === null) return false;
  return [center.x - root, center.x + root].some(
    (x) => x >= rect.minX - EPSILON && x <= rect.maxX + EPSILON && onSweep({ x, y }),
  );
}

function circleRoot(radius: number, delta: number): number | null {
  const squared = radius * radius - delta * delta;
  return squared < -EPSILON ? null : Math.sqrt(Math.max(0, squared));
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
  );
}

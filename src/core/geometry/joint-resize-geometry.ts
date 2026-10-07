import type { Vec2 } from '../scene';

const EPS = 1e-7;
export const jointPointEqual = (a: Vec2, b: Vec2): boolean => distance(a, b) <= EPS;
export const subtract = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const unit = (v: Vec2): Vec2 => {
  const length = Math.hypot(v.x, v.y);
  return { x: v.x / length, y: v.y / length };
};
export function normalizeJointPoints(points: ReadonlyArray<Vec2>): Vec2[] {
  const result = [...points];
  if (result.length > 1 && jointPointEqual(result[0] as Vec2, result[result.length - 1] as Vec2))
    result.pop();
  return result;
}
export function signedJointArea(points: ReadonlyArray<Vec2>): number {
  return (
    points.reduce(
      (sum, point, i) => sum + cross(point, points[(i + 1) % points.length] as Vec2),
      0,
    ) / 2
  );
}
export function parallel(a: Vec2, b: Vec2): boolean {
  return Math.abs(cross(unit(a), unit(b))) <= EPS;
}
export function perpendicular(a: Vec2, b: Vec2): boolean {
  return Math.abs(dot(unit(a), unit(b))) <= EPS;
}
export function orthogonalJointPolygon(points: ReadonlyArray<Vec2>): boolean {
  const axis = subtract(points[1] as Vec2, points[0] as Vec2);
  return points.every((p, i) => {
    const edge = subtract(points[(i + 1) % points.length] as Vec2, p);
    return parallel(axis, edge) || perpendicular(axis, edge);
  });
}
export function simpleJointPolygon(points: ReadonlyArray<Vec2>): boolean {
  if (points.length < 4 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return false;
  if (Math.abs(signedJointArea(points)) <= EPS) return false;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    if (distance(a, b) <= EPS) return false;
    for (let j = i + 1; j < points.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (jointSegmentsIntersect(a, b, points[j] as Vec2, points[(j + 1) % points.length] as Vec2))
        return false;
    }
  }
  return true;
}
function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  const value = cross(subtract(b, a), subtract(c, a));
  return Math.abs(value) <= EPS ? 0 : Math.sign(value);
}
function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    orientation(a, b, p) === 0 &&
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}
export function jointSegmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const oa = orientation(a, b, c),
    ob = orientation(a, b, d);
  const oc = orientation(c, d, a),
    od = orientation(c, d, b);
  return (
    (oa * ob < 0 && oc * od < 0) ||
    (oa === 0 && onSegment(a, b, c)) ||
    (ob === 0 && onSegment(a, b, d)) ||
    (oc === 0 && onSegment(c, d, a)) ||
    (od === 0 && onSegment(c, d, b))
  );
}
export function jointContoursIntersect(a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>): boolean {
  return a.some((p, i) =>
    b.some((q, j) =>
      jointSegmentsIntersect(p, a[(i + 1) % a.length] as Vec2, q, b[(j + 1) % b.length] as Vec2),
    ),
  );
}
export function insideJointPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i] as Vec2,
      b = polygon[j] as Vec2;
    if (onSegment(a, b, point)) return false;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
/** Strict containment or separation. Touching/crossing contours have no safe relationship. */
export function jointContourRelation(
  a: ReadonlyArray<Vec2>,
  b: ReadonlyArray<Vec2>,
): 'inside' | 'outside' | 'separate' | 'intersect' {
  if (jointContoursIntersect(a, b)) return 'intersect';
  if (insideJointPolygon(a[0] as Vec2, b)) return 'inside';
  if (insideJointPolygon(b[0] as Vec2, a)) return 'outside';
  return 'separate';
}

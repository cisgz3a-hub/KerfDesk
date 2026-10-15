import { pointInPolygon } from '../geometry/point-in-polygon';
import type { Polyline, Vec2 } from '../scene';

export function inRegion(point: Vec2, region: ReadonlyArray<Polyline>): boolean {
  // The proven tool-centre region is closed. Interpolation can round an
  // interior link sample onto or a few ULPs beyond an edge. Account only
  // for floating-point roundoff at this coordinate scale, not a machining tolerance.
  if (region.some((contour) => onBoundary(point, contour.points))) return true;
  return region.filter((contour) => pointInPolygon(point, contour.points)).length % 2 === 1;
}

export function onBoundary(point: Vec2, points: ReadonlyArray<Vec2>): boolean {
  return points.some((a, index) => {
    const b = points[(index + 1) % points.length];
    if (b === undefined) return false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const cross = (point.x - a.x) * dy - (point.y - a.y) * dx;
    // A handful of rounded operations forms the interpolated point and this
    // determinant. Scale the allowance in coordinate units, then convert it
    // to determinant units with the edge length; never use a fixed mm epsilon.
    const coordinateScale = Math.max(
      Math.abs(point.x),
      Math.abs(point.y),
      Math.abs(a.x),
      Math.abs(a.y),
      Math.abs(b.x),
      Math.abs(b.y),
    );
    const roundoff = 8 * Number.EPSILON * coordinateScale;
    return (
      Math.abs(cross) <= roundoff * (Math.abs(dx) + Math.abs(dy)) &&
      point.x >= Math.min(a.x, b.x) - roundoff &&
      point.x <= Math.max(a.x, b.x) + roundoff &&
      point.y >= Math.min(a.y, b.y) - roundoff &&
      point.y <= Math.max(a.y, b.y) + roundoff
    );
  });
}

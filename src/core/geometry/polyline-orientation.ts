// Polyline orientation helpers (H.9 motion polish). Shoelace signed area in
// the machine frame (Y up): positive = counter-clockwise.

import type { Polyline, Vec2 } from '../scene';

export function signedAreaMm2(points: ReadonlyArray<Vec2>): number {
  let doubled = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    doubled += a.x * b.y - b.x * a.y;
  }
  return doubled / 2;
}

export function isCounterClockwise(polyline: Polyline): boolean {
  return signedAreaMm2(polyline.points) > 0;
}

export function reversedPolyline(polyline: Polyline): Polyline {
  return { ...polyline, points: [...polyline.points].reverse() };
}

/**
 * The contours of ONE offset or boolean result, all reversed when the largest
 * winds negative, so the outer boundaries come out positive and the holes
 * negative. One result's holes always wind opposite its outer boundaries, and
 * its largest contour is an outer boundary, but the engines disagree on the
 * sign: marching squares winds outer boundaries positive, the offset engine
 * negative. Contours from different results can be compared only after this.
 */
export function withOuterContoursPositive(
  contours: ReadonlyArray<Polyline>,
): ReadonlyArray<Polyline> {
  let largestArea = 0;
  let sign = 0;
  for (const contour of contours) {
    const area = signedAreaMm2(contour.points);
    if (Math.abs(area) > largestArea) {
      largestArea = Math.abs(area);
      sign = Math.sign(area);
    }
  }
  return sign < 0 ? contours.map((contour) => reversedPolyline(contour)) : contours;
}

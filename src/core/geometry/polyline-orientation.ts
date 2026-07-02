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

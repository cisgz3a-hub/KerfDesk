import type { Bounds, Polyline } from '../scene';

export function boundsOfPolylines(polylines: ReadonlyArray<Polyline>): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const polyline of polylines) {
    for (const point of polyline.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  if (xs.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

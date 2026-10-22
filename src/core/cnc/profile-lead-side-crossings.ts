// Exact side test for an emitted lead polyline against one closed ring
// (ADR-250, corrected 2026-09-05). Shared by the lead's own-contour and
// sibling checks and by the job-wide kept-wall check (ADR-250 Amendment 3).

import { pointInPolygon } from '../geometry';
import type { Vec2 } from '../scene';

// Tab interpolation can place an analytically shared contour endpoint at
// 1 - ~1e-16 on the lead chord. Treat only parameter-scale roundoff as the
// endpoint; real boundary crossings farther into the segment remain cuts.
const BOUNDARY_PARAMETER_EPSILON = 1e-12;

// Polygon membership can change only at a boundary intersection. Split each
// emitted line/chord there and inspect every intervening open interval, rather
// than adding a sampling spacing that could still miss a thin kept feature.
export function segmentsStayOnSide(
  points: ReadonlyArray<Vec2>,
  polygon: ReadonlyArray<Vec2>,
  inside: boolean,
): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1] as Vec2;
    const end = points[i] as Vec2;
    const cuts = segmentBoundaryCuts(start, end, polygon);
    for (let j = 1; j < cuts.length; j += 1) {
      const from = cuts[j - 1] as number;
      const to = cuts[j] as number;
      if (from === to) continue;
      const t = (from + to) / 2;
      const midpoint = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
      if (pointInPolygon(midpoint, polygon) !== inside) return false;
    }
  }
  return true;
}

function segmentBoundaryCuts(a: Vec2, b: Vec2, polygon: ReadonlyArray<Vec2>): number[] {
  const cuts = [0, 1];
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  for (let i = 0; i < polygon.length; i += 1) {
    const c = polygon[i] as Vec2;
    const d = polygon[(i + 1) % polygon.length] as Vec2;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const cross = rx * sy - ry * sx;
    if (cross === 0) continue;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / cross;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / cross;
    if (t > BOUNDARY_PARAMETER_EPSILON && t < 1 - BOUNDARY_PARAMETER_EPSILON && u >= 0 && u <= 1) {
      cuts.push(t);
    }
  }
  cuts.sort((left, right) => left - right);
  return cuts.filter(
    (cut, index) => index === 0 || cut - (cuts[index - 1] as number) > BOUNDARY_PARAMETER_EPSILON,
  );
}

// Ray-cast point-in-polygon (even-odd rule). The single containment test in
// the tree: kerf-offset, profile-ordering, compile-cnc-helpers, helical-entry,
// adaptive-pocket-verifier, and line-art-contours all import THIS — an
// edge-semantics change here (on-boundary probes, epsilon) reaches every
// caller at once, which is the point of the consolidation (tidy-first,
// rolling audit 2026-07-17-0745 P3-1).

import type { Vec2 } from '../scene';

export function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const crossesY = a.y > point.y !== b.y > point.y;
    if (!crossesY) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

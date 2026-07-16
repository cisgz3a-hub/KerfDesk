// Ray-cast point-in-polygon (even-odd rule). Extracted because this is the
// third containment test in the tree — kerf-offset.ts and profile-ordering.ts
// still carry older local copies; migrating them here is a separate tidy-first
// refactor so feature diffs stay single-concern.

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

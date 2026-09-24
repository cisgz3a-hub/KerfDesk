// Merges a module grid's dark cells into as few closed outlines as possible:
// one outline per 4-connected dark region plus one per enclosed light hole,
// with every vertex on a module corner. Engraving then fills whole regions
// instead of one square per module, and no edge falls between modules.

import type { Vec2 } from '../scene';
import { traceBoundaryLoops } from '../trace/contour-boundary';

/** Closed loops in module units (first point repeated at the end). */
export function moduleContours(columns: number, rows: number, dark: ArrayLike<number>): Vec2[][] {
  const ink = Uint8Array.from({ length: columns * rows }, (_value, index) =>
    dark[index] === 1 ? 1 : 0,
  );
  return traceBoundaryLoops({ width: columns, height: rows, ink }).map((loop) =>
    closeLoop(dropCollinear(loop.points)),
  );
}

// The tracer emits one vertex per unit edge; keep only the corners.
function dropCollinear(points: readonly Vec2[]): Vec2[] {
  const corners: Vec2[] = [];
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const previous = points[(index + count - 1) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    if (previous === undefined || current === undefined || next === undefined) continue;
    const cross =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);
    if (cross !== 0) corners.push(current);
  }
  return corners;
}

function closeLoop(points: Vec2[]): Vec2[] {
  const first = points[0];
  return first === undefined ? points : [...points, first];
}

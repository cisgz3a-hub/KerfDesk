// dropCollinearPoints — remove the vertices that lie on the straight segment
// between the ones kept either side of them, so a path traced cell by cell (a
// relief roughing ring's staircase, ADR-488) emits one G-code move per
// straight run instead of one per cell. Only exact collinearity counts: every
// dropped vertex lies within COLLINEAR_MM of the segment that replaces it, in
// order along it, so the path the cutter follows does not change. Z counts
// too where the points carry it, so a ramp keeps its slope.

import type { Vec2 } from '../scene';

// Floating-point noise only, far below the emitter's 0.001 mm grid.
const COLLINEAR_MM = 1e-9;

type Point = Vec2 & { readonly z?: number };
type Direction = { readonly x: number; readonly y: number; readonly z: number };

export function dropCollinearPoints<T extends Point>(points: ReadonlyArray<T>): T[] {
  const first = points[0];
  if (first === undefined) return [];
  const out: T[] = [first];
  let anchor = 0;
  while (anchor < points.length - 1) {
    anchor = farthestCollinear(points, anchor);
    out.push(points[anchor] as T);
  }
  return out;
}

// The farthest vertex a straight segment from `anchor` reaches while every
// vertex it skips lies within COLLINEAR_MM of the line the first of them
// starts, moving forward along it. The segment's end lies on that line too, so
// the skipped vertices stay within twice that of the segment itself.
function farthestCollinear<T extends Point>(points: ReadonlyArray<T>, anchor: number): number {
  const a = points[anchor] as T;
  let direction: Direction | null = null;
  let along = 0;
  let reach = anchor + 1;
  for (let j = anchor + 1; j < points.length; j += 1) {
    const p = points[j] as T;
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const dz = (p.z ?? 0) - (a.z ?? 0);
    if (direction === null) {
      const length = Math.hypot(dx, dy, dz);
      reach = j;
      // A repeat of the anchor itself adds no move.
      if (length <= COLLINEAR_MM) continue;
      direction = { x: dx / length, y: dy / length, z: dz / length };
      along = length;
      continue;
    }
    const s = dx * direction.x + dy * direction.y + dz * direction.z;
    const off = Math.hypot(dx - s * direction.x, dy - s * direction.y, dz - s * direction.z);
    if (off > COLLINEAR_MM || !(s >= along)) break;
    along = s;
    reach = j;
  }
  return reach;
}

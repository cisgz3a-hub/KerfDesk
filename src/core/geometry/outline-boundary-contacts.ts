// Which outlines have boundaries that come close to each other. Two outlines
// whose edges all stay apart cannot cross, so one lies wholly inside or wholly
// outside the other and a single point decides containment. Only outlines
// that do approach each other need the full boundary test.
import type { Vec2 } from '../scene';
import { ContourBoxIndex } from '../trace/contour-box-index';
import { runTraceSteps } from '../trace/trace-steps';

/** The unordered pair key `outlineContactKey(i, j)` uses. */
export function outlineContactKey(i: number, j: number, count: number): number {
  return i < j ? i * count + j : j * count + i;
}

/**
 * Keys (see outlineContactKey) of outline pairs with an edge of one within
 * `delta` of an edge of the other, closing edges included. Only outlines in
 * `members` take part. Null when a coordinate is not finite, so the caller
 * keeps its exact unindexed path for such input.
 */
export function outlineBoundaryContacts(
  outlines: ReadonlyArray<ReadonlyArray<Vec2>>,
  members: ReadonlyArray<number>,
  delta: number,
): Set<number> | null {
  const edges = collectEdges(outlines, members);
  if (edges === null) return null;
  const { bounds, ends, owner } = edges;
  const index = runTraceSteps(
    ContourBoxIndex.overBoundsSteps(bounds, (i) => ({
      minX: bounds[4 * i] as number,
      minY: bounds[4 * i + 1] as number,
      maxX: bounds[4 * i + 2] as number,
      maxY: bounds[4 * i + 3] as number,
    })),
  );
  const contacts = new Set<number>();
  const count = outlines.length;
  const visit = (i: number, j: number): void => {
    const a = owner[i] as number;
    const b = owner[j] as number;
    if (a === b) return;
    const key = outlineContactKey(a, b, count);
    if (!contacts.has(key) && edgesWithin(ends, i, j, delta)) contacts.add(key);
  };
  runTraceSteps(index.overlapIdsSteps(index, visit, false, delta));
  return contacts;
}

type Edges = {
  readonly bounds: Float64Array;
  readonly ends: Float64Array;
  readonly owner: Int32Array;
};

function collectEdges(
  outlines: ReadonlyArray<ReadonlyArray<Vec2>>,
  members: ReadonlyArray<number>,
): Edges | null {
  let total = 0;
  for (const member of members) total += outlines[member]?.length ?? 0;
  const bounds = new Float64Array(4 * total);
  const ends = new Float64Array(4 * total);
  const owner = new Int32Array(total);
  let edge = 0;
  for (const member of members) {
    const outline = outlines[member] ?? [];
    for (let k = 0; k < outline.length; k += 1) {
      const a = outline[k] as Vec2;
      const b = outline[(k + 1) % outline.length] as Vec2;
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
      ends.set([a.x, a.y, b.x, b.y], 4 * edge);
      bounds.set(
        [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)],
        4 * edge,
      );
      owner[edge] = member;
      edge += 1;
    }
  }
  return { bounds, ends, owner };
}

// Conservative: crossing segments, or any endpoint within `delta` of the
// other segment. A false "near" only costs the exact test.
function edgesWithin(ends: Float64Array, i: number, j: number, delta: number): boolean {
  const p = 4 * i;
  const q = 4 * j;
  const ax = ends[p] as number,
    ay = ends[p + 1] as number,
    bx = ends[p + 2] as number,
    by = ends[p + 3] as number;
  const cx = ends[q] as number,
    cy = ends[q + 1] as number,
    dx = ends[q + 2] as number,
    dy = ends[q + 3] as number;
  if (properlyCross(ax, ay, bx, by, cx, cy, dx, dy)) return true;
  return (
    pointSegmentDistance(ax, ay, cx, cy, dx, dy) <= delta ||
    pointSegmentDistance(bx, by, cx, cy, dx, dy) <= delta ||
    pointSegmentDistance(cx, cy, ax, ay, bx, by) <= delta ||
    pointSegmentDistance(dx, dy, ax, ay, bx, by) <= delta
  );
}

function properlyCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const c1 = orient(ax, ay, bx, by, cx, cy);
  const c2 = orient(ax, ay, bx, by, dx, dy);
  const c3 = orient(cx, cy, dx, dy, ax, ay);
  const c4 = orient(cx, cy, dx, dy, bx, by);
  return c1 * c2 < 0 && c3 * c4 < 0;
}

function orient(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return Math.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax));
}

function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const squared = ex * ex + ey * ey;
  const t =
    squared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / squared));
  return Math.hypot(px - (ax + t * ex), py - (ay + t * ey));
}

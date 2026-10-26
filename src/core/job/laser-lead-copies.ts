// Copies of one closed outline (ADR-626): the same shape cut by two operations,
// or two artworks drawn on top of each other. Laser leads count a copy once,
// or a hole inside a twice-cut outline would read as an outer contour, and a
// lead may cross its own outline's copies. Moved here from laser-lead-rings.ts
// so the scene's contours (laser-lead-sides.ts) are matched the same way.

import type { Vec2 } from '../scene';
import { polylineBounds, type SegmentBounds } from './segment-bounds';

/** A closed outline as copy matching reads it. */
export type LeadOutline = {
  /** The outline; its last point may repeat its first. */
  readonly points: ReadonlyArray<Vec2>;
  readonly bounds: SegmentBounds;
  readonly lengthMm: number;
};

// Two rings are one outline cut twice when their bounds and lengths agree to
// within this.
const COPY_MM = 0.01;
const COPY_LENGTH_RELATIVE = 1e-4;
// Copies are looked up by their lower-left corner on a grid this fine.
const COPY_CELL_MM = 0.1;
// A vertex this close to the straight line through its neighbours only splits
// an edge (a contour started mid-edge gains one), so copies ignore it.
const STRAIGHT_MM = 1e-6;

export function leadOutline(points: ReadonlyArray<Vec2>): LeadOutline {
  return {
    points,
    bounds: polylineBounds(points) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    lengthMm: outlineLength(points),
  };
}

/** For each outline, the first representative it directly matches. Approximate
 * copy matching is not transitive: a chain must not widen COPY_MM. */
export function copyRepresentatives(outlines: ReadonlyArray<LeadOutline>): number[] {
  const cells = new Map<string, number[]>();
  const representatives: number[] = [];
  const cellOf = (value: number): number => Math.round(value / COPY_CELL_MM);
  outlines.forEach((outline, index) => {
    const cx = cellOf(outline.bounds.minX);
    const cy = cellOf(outline.bounds.minY);
    const copy = earlierCopy(outline, outlines, cells, cx, cy);
    representatives.push(copy ?? index);
    // Only representatives are candidates, so every member stays within the
    // tolerance of the outline used to decide containment.
    if (copy !== null) return;
    const key = `${cx},${cy}`;
    const list = cells.get(key);
    if (list === undefined) cells.set(key, [index]);
    else list.push(index);
  });
  return representatives;
}

/** For each member, the other members that share its representative. */
export function copyLists(representatives: ReadonlyArray<number>): number[][] {
  const members = new Map<number, number[]>();
  representatives.forEach((representative, index) => {
    const list = members.get(representative);
    if (list === undefined) members.set(representative, [index]);
    else list.push(index);
  });
  return representatives.map((representative, index) =>
    (members.get(representative) ?? []).filter((other) => other !== index),
  );
}

function earlierCopy(
  outline: LeadOutline,
  outlines: ReadonlyArray<LeadOutline>,
  cells: ReadonlyMap<string, ReadonlyArray<number>>,
  cx: number,
  cy: number,
): number | null {
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (const other of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        const candidate = outlines[other];
        if (candidate !== undefined && outlinesAreCopies(outline, candidate)) return other;
      }
    }
  }
  return null;
}

// Same bounds and length first, cheaply; then the outlines themselves, vertex
// by vertex: a copy is the same loop, perhaps started elsewhere or run the other
// way, every corner within COPY_MM. Vertices that only split a straight edge
// do not count, so an outline started mid-edge still matches its copy. Two
// different shapes that share bounds and length (mirrored L shapes, or detours
// between sampled points) stay apart.
export function outlinesAreCopies(a: LeadOutline, b: LeadOutline): boolean {
  return (
    Math.abs(a.bounds.minX - b.bounds.minX) <= COPY_MM &&
    Math.abs(a.bounds.minY - b.bounds.minY) <= COPY_MM &&
    Math.abs(a.bounds.maxX - b.bounds.maxX) <= COPY_MM &&
    Math.abs(a.bounds.maxY - b.bounds.maxY) <= COPY_MM &&
    Math.abs(a.lengthMm - b.lengthMm) <= COPY_MM + a.lengthMm * COPY_LENGTH_RELATIVE &&
    sameLoop(cornerLoop(a), cornerLoop(b))
  );
}

const corners = new WeakMap<LeadOutline, ReadonlyArray<Vec2>>();

/** The loop's corners: no closing point that repeats the first, no repeated
 * points, and no vertex that lies on the straight edge through its neighbours. */
function cornerLoop(outline: LeadOutline): ReadonlyArray<Vec2> {
  const known = corners.get(outline);
  if (known !== undefined) return known;
  const kept: Vec2[] = [];
  for (const point of outline.points) {
    const last = kept[kept.length - 1];
    if (last !== undefined && point.x === last.x && point.y === last.y) continue;
    kept.push(point);
    while (kept.length >= 3 && splitsEdge(kept.at(-3), kept.at(-2), kept.at(-1)))
      kept.splice(-2, 1);
  }
  closeSeam(kept);
  corners.set(outline, kept);
  return kept;
}

/** Drops a closing point that repeats the first, and edge-splitting vertices
 * across the seam where the loop closes. */
function closeSeam(kept: Vec2[]): void {
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (kept.length > 1 && first !== undefined && last !== undefined && near(first, last)) kept.pop();
  while (kept.length >= 3 && splitsEdge(kept.at(-2), kept.at(-1), kept[0])) kept.pop();
  while (kept.length >= 3 && splitsEdge(kept.at(-1), kept[0], kept[1])) kept.shift();
}

/** Whether `vertex` only splits the straight edge from `before` to `after`. */
function splitsEdge(before: Vec2 | undefined, vertex: Vec2 | undefined, after: Vec2 | undefined) {
  if (before === undefined || vertex === undefined || after === undefined) return false;
  const ax = vertex.x - before.x;
  const ay = vertex.y - before.y;
  const bx = after.x - vertex.x;
  const by = after.y - vertex.y;
  const span = Math.hypot(after.x - before.x, after.y - before.y);
  return ax * bx + ay * by > 0 && Math.abs(ax * by - ay * bx) <= STRAIGHT_MM * span;
}

function sameLoop(a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>): boolean {
  const start = a[0];
  if (start === undefined || a.length !== b.length) return false;
  for (let offset = 0; offset < b.length; offset += 1) {
    if (!near(start, b[offset] as Vec2)) continue;
    if (walksAlong(a, b, offset, 1) || walksAlong(a, b, offset, -1)) return true;
  }
  return false;
}

function walksAlong(
  a: ReadonlyArray<Vec2>,
  b: ReadonlyArray<Vec2>,
  offset: number,
  step: 1 | -1,
): boolean {
  const count = b.length;
  for (let index = 1; index < a.length; index += 1) {
    const other = b[(((offset + step * index) % count) + count) % count] as Vec2;
    if (!near(a[index] as Vec2, other)) return false;
  }
  return true;
}

function near(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= COPY_MM && Math.abs(a.y - b.y) <= COPY_MM;
}

function outlineLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

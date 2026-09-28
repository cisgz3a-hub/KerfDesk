import type { Vec2 } from '../scene';

// Arcs of a cutter's rim for the adaptive verifier's exact contact (ADR-154
// Amendment 3): the rim points strictly within reach of a disk or of a
// straight move, in closed form, and the arithmetic on what stays open.

export const TAU = 2 * Math.PI;
// A move this short, or a disk centre this close, is a point.
export const POINT_MM = 1e-9;
// Arcs shorter than this are rounding dust, not stock.
const DUST_RAD = 1e-12;

// Flat [start, end, ...] intervals of rim angle within [0, TAU]. The open
// part of the rim is kept sorted and disjoint; the arcs a move clears need
// not be, since `subtract` takes them one at a time.
export type Arcs = ReadonlyArray<number>;

// A straight move from `a`, its length, unit direction and that direction's
// angle.
export type RimMove = {
  readonly a: Vec2;
  readonly length: number;
  readonly ux: number;
  readonly uy: number;
  readonly heading: number;
};

// Rim points strictly inside the disk of `radius` about `centre`.
export function rimArcsInDisk(point: Vec2, r: number, centre: Vec2, radius: number): Arcs {
  const dx = centre.x - point.x;
  const dy = centre.y - point.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance <= POINT_MM) return radius > r ? [0, TAU] : [];
  const cosHalf = (r * r + distance * distance - radius * radius) / (2 * r * distance);
  if (cosHalf >= 1) return [];
  if (cosHalf <= -1) return [0, TAU];
  const half = Math.acos(cosHalf);
  const middle = Math.atan2(dy, dx);
  return arcBetween(middle - half, middle + half);
}

// Rim points whose foot on the move's line falls strictly inside the move and
// lies strictly within r of it. With the rim angle p measured from the move's
// direction: 0 < along + r cos p < length and |across + r sin p| < r.
export function rimArcsInStrip(point: Vec2, r: number, move: RimMove): Arcs {
  const { a, length, ux, uy, heading } = move;
  if (length <= POINT_MM) return [];
  const along = (point.x - a.x) * ux + (point.y - a.y) * uy;
  const across = (point.y - a.y) * ux - (point.x - a.x) * uy;
  let local: Arcs = cosAbove(-along / r);
  local = intersect(local, cosBelow((length - along) / r));
  local = intersect(local, sinBelow(1 - across / r));
  local = intersect(local, sinAbove(-1 - across / r));
  // Turned into rim angles, the pieces may wrap past zero or overlap each
  // other; `subtract` takes them one at a time, so neither matters.
  const arcs: number[] = [];
  for (let index = 0; index + 1 < local.length; index += 2) {
    arcs.push(...arcBetween((local[index] ?? 0) + heading, (local[index + 1] ?? 0) + heading));
  }
  return arcs;
}

// `open` minus the cleared arcs; `open` itself when they miss it.
export function subtract(open: Arcs, cleared: Arcs): Arcs {
  let result = open;
  for (let index = 0; index + 1 < cleared.length && result.length > 0; index += 2) {
    const start = cleared[index] ?? 0;
    const end = cleared[index + 1] ?? 0;
    if (overlaps(result, start, end)) result = withoutInterval(result, start, end);
  }
  return result;
}

// The longest open arc, joining the pieces either side of angle zero.
export function largestCircularArc(open: Arcs): number {
  if (open.length === 0) return 0;
  let largest = 0;
  for (let index = 0; index + 1 < open.length; index += 2) {
    largest = Math.max(largest, (open[index + 1] ?? 0) - (open[index] ?? 0));
  }
  const first = open[0] ?? 0;
  const last = open[open.length - 1] ?? 0;
  if (open.length > 2 && first <= DUST_RAD && last >= TAU - DUST_RAD) {
    largest = Math.max(largest, (open[1] ?? 0) + TAU - (open[open.length - 2] ?? 0));
  }
  return largest;
}

function cosAbove(value: number): Arcs {
  if (value >= 1) return [];
  if (value < -1) return [0, TAU];
  const half = Math.acos(value);
  return [0, half, TAU - half, TAU];
}

function cosBelow(value: number): Arcs {
  if (value <= -1) return [];
  if (value > 1) return [0, TAU];
  const half = Math.acos(value);
  return [half, TAU - half];
}

function sinBelow(value: number): Arcs {
  if (value <= -1) return [];
  if (value > 1) return [0, TAU];
  const edge = Math.asin(value);
  return edge >= 0 ? [0, edge, Math.PI - edge, TAU] : [Math.PI - edge, TAU + edge];
}

function sinAbove(value: number): Arcs {
  if (value >= 1) return [];
  if (value < -1) return [0, TAU];
  const edge = Math.asin(value);
  return edge >= 0 ? [edge, Math.PI - edge] : [0, Math.PI - edge, TAU + edge, TAU];
}

// The arc from `start` counter-clockwise to `end`, as intervals within [0, TAU].
function arcBetween(start: number, end: number): Arcs {
  const length = end - start;
  if (length >= TAU) return [0, TAU];
  if (length <= DUST_RAD) return [];
  const from = ((start % TAU) + TAU) % TAU;
  const to = from + length;
  return to <= TAU ? [from, to] : [0, to - TAU, from, TAU];
}

function withoutInterval(open: Arcs, start: number, end: number): Arcs {
  const next: number[] = [];
  for (let at = 0; at + 1 < open.length; at += 2) {
    const from = open[at] ?? 0;
    const to = open[at + 1] ?? 0;
    if (to <= start || from >= end) {
      next.push(from, to);
      continue;
    }
    if (start - from > DUST_RAD) next.push(from, start);
    if (to - end > DUST_RAD) next.push(end, to);
  }
  return next;
}

function overlaps(arcs: Arcs, start: number, end: number): boolean {
  for (let index = 0; index + 1 < arcs.length; index += 2) {
    if (Math.min(arcs[index + 1] ?? 0, end) - Math.max(arcs[index] ?? 0, start) > DUST_RAD) {
      return true;
    }
  }
  return false;
}

function intersect(first: Arcs, second: Arcs): Arcs {
  const result: number[] = [];
  let i = 0;
  let j = 0;
  while (i + 1 < first.length && j + 1 < second.length) {
    const start = Math.max(first[i] ?? 0, second[j] ?? 0);
    const end = Math.min(first[i + 1] ?? 0, second[j + 1] ?? 0);
    if (end - start > DUST_RAD) result.push(start, end);
    if ((first[i + 1] ?? 0) < (second[j + 1] ?? 0)) i += 2;
    else j += 2;
  }
  return result;
}

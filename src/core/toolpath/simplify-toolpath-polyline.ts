// Fewest straight moves within a physical tolerance (tracer audit Finding 5,
// ADR-391). A traced outline arrives as vertices every ~1.5 trace pixels, and
// every vertex becomes one G1 move. GRBL 1.1's planner source notes that many
// short segments "may seem to move slow" and lists maximizing line motion
// distance per block to a desired tolerance as the remedy. This pass keeps
// only the vertices needed to stay within the tolerance (Douglas-Peucker,
// 1973): every dropped vertex lies within the tolerance of the move that
// replaces it, so the whole path does. Drawn corners, open-chain endpoints and
// ring seams are always kept, and kept vertices are the input's own points.

import type { Polyline, Vec2 } from '../scene';

export type ToolpathSimplifyOptions = {
  /** Physical size of one polyline unit along each local axis, mm. Rotation
   *  and mirroring preserve distance, so the absolute axis scales define the
   *  metric. Non-finite or non-positive values disable the pass. */
  readonly mmPerUnitX: number;
  readonly mmPerUnitY: number;
  /** Largest distance between the input path and the simplified path, mm. */
  readonly toleranceMm: number;
  /** Vertices turning at least this much are drawn corners and always kept. */
  readonly cornerAngleDeg: number;
};

const MIN_SIMPLIFY_POINTS = 3;
// Below this distance, in local units, two points are one position: the same
// explicit ring-closure epsilon the tracer's loop closure uses.
const SAME_POINT_EPS = 1e-6;
// A ring needs three distinct corners to enclose anything.
const MIN_RING_VERTICES = 3;

/** Simplify one polyline to the fewest vertices within the tolerance. Returns
 *  the input object when nothing can be removed or the options are unusable. */
export function simplifyToolpathPolyline(
  polyline: Polyline,
  options: ToolpathSimplifyOptions,
): Polyline {
  const points = polyline.points;
  if (points.length < MIN_SIMPLIFY_POINTS || !usableOptions(options)) return polyline;
  const mapped = points.map((point) => ({
    x: point.x * options.mmPerUnitX,
    y: point.y * options.mmPerUnitY,
  }));
  const keep = pinnedVertices(points, mapped, options.cornerAngleDeg);
  const toleranceSq = options.toleranceMm * options.toleranceMm;
  let from = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (keep[index] !== 1) continue;
    keepDeviatingVertices(mapped, from, index, toleranceSq, keep);
    from = index;
  }
  const kept = points.filter((_, index) => keep[index] === 1);
  if (kept.length === points.length) return polyline;
  // A ring within the tolerance of a point or a line would collapse. Keep its
  // geometry: the pass reduces moves and never deletes drawn marks.
  if (polyline.closed && ringVertexCount(kept, polyline) < MIN_RING_VERTICES) return polyline;
  return { points: kept, closed: polyline.closed };
}

// Distinct ring vertices: an explicit ring repeats its seam as its last point.
function ringVertexCount(kept: ReadonlyArray<Vec2>, polyline: Polyline): number {
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  const explicit = first !== undefined && last !== undefined && samePoint(first, last);
  return explicit ? kept.length - 1 : kept.length;
}

function usableOptions(options: ToolpathSimplifyOptions): boolean {
  return (
    isPositiveFinite(options.mmPerUnitX) &&
    isPositiveFinite(options.mmPerUnitY) &&
    isPositiveFinite(options.toleranceMm) &&
    Number.isFinite(options.cornerAngleDeg)
  );
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

// Endpoints (an open chain's ends, or a ring's seam and its explicit return)
// plus every vertex that turns at least the corner angle. A repeated point is
// the same corner: only its first copy is pinned, so no zero-length move stays.
function pinnedVertices(
  points: ReadonlyArray<Vec2>,
  mapped: ReadonlyArray<Vec2>,
  cornerAngleDeg: number,
): Uint8Array {
  const count = points.length;
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const cornerTurnRad = (cornerAngleDeg * Math.PI) / 180;
  for (let index = 1; index < count - 1; index += 1) {
    if (samePoint(points[index - 1] as Vec2, points[index] as Vec2)) continue;
    const previous = distinctNeighbour(points, mapped, index, -1);
    const next = distinctNeighbour(points, mapped, index, 1);
    if (previous === null || next === null) continue;
    if (turnRad(previous, mapped[index] as Vec2, next) >= cornerTurnRad) keep[index] = 1;
  }
  return keep;
}

// The nearest vertex in `direction` at a different position, so a repeated
// point at a corner still measures the corner's turn.
function distinctNeighbour(
  points: ReadonlyArray<Vec2>,
  mapped: ReadonlyArray<Vec2>,
  index: number,
  direction: -1 | 1,
): Vec2 | null {
  const at = points[index] as Vec2;
  for (let cursor = index + direction; cursor >= 0 && cursor < points.length; cursor += direction) {
    if (!samePoint(points[cursor] as Vec2, at)) return mapped[cursor] as Vec2;
  }
  return null;
}

function turnRad(previous: Vec2, at: Vec2, next: Vec2): number {
  const inX = at.x - previous.x;
  const inY = at.y - previous.y;
  const outX = next.x - at.x;
  const outY = next.y - at.y;
  return Math.abs(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY));
}

// Douglas-Peucker between two kept vertices: keep the farthest vertex while
// it lies beyond the tolerance of the chord, and split there.
function keepDeviatingVertices(
  mapped: ReadonlyArray<Vec2>,
  first: number,
  last: number,
  toleranceSq: number,
  keep: Uint8Array,
): void {
  const ranges: Array<readonly [number, number]> = [[first, last]];
  for (let range = ranges.pop(); range !== undefined; range = ranges.pop()) {
    const [from, to] = range;
    let worst = -1;
    let worstSq = toleranceSq;
    for (let index = from + 1; index < to; index += 1) {
      const distanceSq = segmentDistanceSq(
        mapped[index] as Vec2,
        mapped[from] as Vec2,
        mapped[to] as Vec2,
      );
      if (distanceSq > worstSq) {
        worstSq = distanceSq;
        worst = index;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    ranges.push([from, worst], [worst, to]);
  }
}

function segmentDistanceSq(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq > 0
      ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq))
      : 0;
  const offsetX = point.x - (start.x + t * dx);
  const offsetY = point.y - (start.y + t * dy);
  return offsetX * offsetX + offsetY * offsetY;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= SAME_POINT_EPS;
}

// Outer-contour / hole grouping by containment (ADR-403).
//
// A closed contour's nesting depth is the number of other closed contours
// that contain it. Under the even-odd rule, even depth is ink (an outer
// contour) and odd depth is a hole; each hole belongs to its smallest
// container. For contours that never cross or duplicate one another (every
// traced contour), grouping an outer with its direct holes reproduces the
// even-odd picture exactly while letting an editor select one island at a
// time.
//
// PRECONDITION: contours are pairwise nested or disjoint. Crossing or
// identical contours are not detected: they land in separate islands, and two
// <path>s fill an overlap that even-odd in one path would cancel. Callers with
// arbitrary artwork must keep grouping opt-in.
//
// Under that precondition, containment of whole contours is decided by one
// vertex: a single interior test is exact whenever the vertex is not ON the
// other boundary. Vertices shared at saddle joins are skipped until a
// decisive one is found.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import { curveSubpathBounds, flattenCurveSubpath } from '../scene/curve-path';
import type { Bounds, CurveSubpath, Vec2 } from '../scene/scene-object';

export type ContourGroup = {
  /** Index into the input array of the outer (even-depth) contour. */
  readonly outer: number;
  /** Indices of the contour's direct holes, in input order. */
  readonly holes: ReadonlyArray<number>;
};

type Ring = {
  readonly index: number;
  readonly bounds: Bounds;
  readonly points: ReadonlyArray<Vec2>;
  readonly area: number;
};

const FLATTEN_RELATIVE_TOLERANCE = 1e-4;

/** Group closed contours into islands; every input index appears exactly once. */
export function groupContoursWithHoles(
  contours: ReadonlyArray<CurveSubpath>,
): ReadonlyArray<ContourGroup> {
  const rings = contours.map(toRing);
  // Largest first: a container always has a larger area than its content.
  const bySize = [...rings].sort((a, b) => b.area - a.area || a.index - b.index);
  const parent = new Map<number, number | null>();
  const depth = new Map<number, number>();
  bySize.forEach((ring, order) => {
    let best: Ring | null = null;
    let count = 0;
    for (let k = 0; k < order; k += 1) {
      const candidate = bySize[k] as Ring;
      if (!(candidate.area > ring.area) || !boundsContain(candidate.bounds, ring.bounds)) continue;
      if (!ringInside(ring, candidate)) continue;
      count += 1;
      if (best === null || candidate.area < best.area) best = candidate;
    }
    parent.set(ring.index, best?.index ?? null);
    depth.set(ring.index, count);
  });
  const groups = new Map<number, number[]>();
  for (const ring of rings) {
    if ((depth.get(ring.index) ?? 0) % 2 === 0) groups.set(ring.index, []);
  }
  for (const ring of rings) {
    if ((depth.get(ring.index) ?? 0) % 2 === 0) continue;
    const owner = parent.get(ring.index);
    const holes = owner === null || owner === undefined ? undefined : groups.get(owner);
    // A hole whose container is not an outer cannot happen for
    // non-crossing contours; keep it visible as its own island.
    if (holes === undefined) groups.set(ring.index, []);
    else holes.push(ring.index);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([outer, holes]) => ({ outer, holes }));
}

function toRing(curve: CurveSubpath, index: number): Ring {
  const bounds = curveSubpathBounds(curve);
  const size = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const flattened = flattenCurveSubpath(curve, {
    toleranceMm: Math.max(size * FLATTEN_RELATIVE_TOLERANCE, 1e-9),
  });
  const points =
    flattened.kind === 'ok'
      ? flattened.polyline.points
      : [curve.start, ...curve.segments.map((s) => s.to)];
  return { index, bounds, points, area: Math.abs(signedArea(points)) };
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Vec2;
    const b = points[(i + 1) % points.length] as Vec2;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

function ringInside(inner: Ring, outer: Ring): boolean {
  const eps =
    1e-9 *
    Math.max(
      1,
      Math.abs(outer.bounds.maxX - outer.bounds.minX),
      Math.abs(outer.bounds.maxY - outer.bounds.minY),
    );
  for (const point of inner.points) {
    const side = classifyPoint(point, outer.points, eps);
    if (side !== 'boundary') return side === 'inside';
  }
  return false;
}

/** Even-odd crossing test with an explicit on-boundary result. */
function classifyPoint(
  p: Vec2,
  ring: ReadonlyArray<Vec2>,
  eps: number,
): 'inside' | 'outside' | 'boundary' {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i] as Vec2;
    const b = ring[j] as Vec2;
    if (onSegment(p, a, b, eps)) return 'boundary';
    if (a.y > p.y !== b.y > p.y) {
      const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (p.x < x) inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}

function onSegment(p: Vec2, a: Vec2, b: Vec2, eps: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= eps;
}

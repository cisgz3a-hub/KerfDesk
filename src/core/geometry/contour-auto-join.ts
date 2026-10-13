// Auto-join for Trim Shapes (LightBurn: "Trim Shapes joins the new vector
// objects at the points where they used to intersect"). Given open contours
// in one coordinate frame, join every pair whose ends meet (within a
// tolerance) at one of the allowed points, and close a contour whose own two
// ends meet there. Only contours that already belong to the anchored group,
// the trimmed object's, take part in a join, so geometry elsewhere is never
// merged by accident. Ends are snapped exactly before joining, so no hairline
// bridge segment is added.

import { curveEndpointJoin, curveNodeCount, type CurveSubpath, type Vec2 } from '../scene';

export type JoinCandidate = {
  readonly curve: CurveSubpath;
  /** Contours of the trimmed object; only these may start a join. */
  readonly anchored: boolean;
};

export type JoinedContour = {
  readonly curve: CurveSubpath;
  readonly anchored: boolean;
  /** Indexes into the input that this contour now contains. */
  readonly sources: ReadonlyArray<number>;
};

type Working = { curve: CurveSubpath; anchored: boolean; sources: number[] };

const MAX_PASSES = 64;

export function joinTouchingContours(
  candidates: ReadonlyArray<JoinCandidate>,
  at: ReadonlyArray<Vec2>,
  tolerance: number,
): { readonly contours: ReadonlyArray<JoinedContour>; readonly joins: number } {
  const work: Working[] = candidates.map((candidate, index) => ({
    curve: candidate.curve,
    anchored: candidate.anchored,
    sources: [index],
  }));
  const near = (point: Vec2) => at.some((target) => distance(point, target) <= tolerance);
  let joins = 0;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const step = joinOnce(work, near, tolerance) ?? closeOnce(work, near, tolerance);
    if (!step) break;
    joins += 1;
  }
  return { contours: work, joins };
}

function ends(curve: CurveSubpath): readonly [Vec2, Vec2] {
  return [curve.start, curve.segments.at(-1)?.to ?? curve.start];
}

function joinOnce(work: Working[], near: (p: Vec2) => boolean, tolerance: number): true | null {
  for (let i = 0; i < work.length; i += 1) {
    const a = work[i] as Working;
    if (!a.anchored || a.curve.closed || a.curve.segments.length === 0) continue;
    for (let j = 0; j < work.length; j += 1) {
      const b = work[j] as Working;
      if (i === j || b.curve.closed || b.curve.segments.length === 0) continue;
      const pair = touchingEnds(a.curve, b.curve, near, tolerance);
      if (pair === null) continue;
      const snapped = snapEnd(b.curve, pair.second, pair.point);
      const result = curveEndpointJoin.join(a.curve, pair.first, snapped, pair.second);
      if (result.kind !== 'ok') continue;
      work[i] = { curve: result.curve, anchored: true, sources: [...a.sources, ...b.sources] };
      work.splice(j, 1);
      return true;
    }
  }
  return null;
}

function closeOnce(work: Working[], near: (p: Vec2) => boolean, tolerance: number): true | null {
  for (let i = 0; i < work.length; i += 1) {
    const a = work[i] as Working;
    if (!a.anchored || a.curve.closed || a.curve.segments.length < 2) continue;
    const [start, end] = ends(a.curve);
    if (distance(start, end) > tolerance || !near(start)) continue;
    const last = curveNodeCount(a.curve) - 1;
    const snapped = snapEnd(a.curve, last, start);
    const result = curveEndpointJoin.close(snapped, 0, last);
    if (result.kind !== 'ok') continue;
    work[i] = { ...a, curve: result.curve };
    return true;
  }
  return null;
}

// Which end of `a` meets which end of `b`, by node index, and where.
function touchingEnds(
  a: CurveSubpath,
  b: CurveSubpath,
  near: (p: Vec2) => boolean,
  tolerance: number,
): { readonly first: number; readonly second: number; readonly point: Vec2 } | null {
  const lastA = curveNodeCount(a) - 1;
  const lastB = curveNodeCount(b) - 1;
  const [aStart, aEnd] = ends(a);
  const [bStart, bEnd] = ends(b);
  const options: ReadonlyArray<readonly [number, Vec2, number, Vec2]> = [
    [lastA, aEnd, 0, bStart],
    [lastA, aEnd, lastB, bEnd],
    [0, aStart, 0, bStart],
    [0, aStart, lastB, bEnd],
  ];
  for (const [first, p, second, q] of options) {
    if (distance(p, q) <= tolerance && near(p)) return { first, second, point: p };
  }
  return null;
}

function snapEnd(curve: CurveSubpath, node: number, point: Vec2): CurveSubpath {
  if (node === 0) return { ...curve, start: point };
  const segments = curve.segments.map((segment, index) =>
    index === curve.segments.length - 1 ? { ...segment, to: point } : segment,
  );
  return { ...curve, segments };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

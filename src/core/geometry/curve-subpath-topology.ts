// curve-subpath-topology — the node-editor operations that change how many
// nodes or subpaths a canonical curve path has (ADR-159, ADR-376): insert a
// node on a segment, delete a segment, break at a node and cut a stretch out.
// Every surviving piece keeps the exact geometry it had; only the removed
// stretch disappears. Indices are explicit (see explicitCurveSubpath), so a
// closed path's closing edge is an ordinary segment here.
//
// Pure core — no I/O, no globals, deterministic.

import type { CurveSubpath, PathSegment, Vec2 } from '../scene';
import {
  explicitCurveSubpath,
  SEGMENT_PARAMETER_EPSILON,
  segmentPiece,
  segmentStartPoint,
  splitSegment,
} from './curve-segment-geometry';

/** A point on a subpath: `t` along explicit segment `segmentIndex`. */
export type CurvePosition = { readonly segmentIndex: number; readonly t: number };

/** Split the segment at `t` so a node appears there and nothing moves.
 *  Null when `t` sits on an existing node or the segment does not exist. */
export function insertCurveNode(
  path: CurveSubpath,
  segmentIndex: number,
  t: number,
): CurveSubpath | null {
  const explicit = explicitCurveSubpath(path);
  const segment = explicit.segments[segmentIndex];
  const from = segmentStartPoint(explicit, segmentIndex);
  if (segment === undefined || from === null) return null;
  if (!(t > SEGMENT_PARAMETER_EPSILON && t < 1 - SEGMENT_PARAMETER_EPSILON)) return null;
  const [first, second] = splitSegment(from, segment, t);
  return {
    ...explicit,
    segments: [
      ...explicit.segments.slice(0, segmentIndex),
      first,
      second,
      ...explicit.segments.slice(segmentIndex + 1),
    ],
  };
}

/** Remove one segment. A closed path opens there; an open path splits in two,
 *  or just shortens when the segment is at an end. Returns the surviving
 *  pieces in path order (possibly none), or null for a missing segment. */
export function deleteCurveSegment(
  path: CurveSubpath,
  segmentIndex: number,
): ReadonlyArray<CurveSubpath> | null {
  const explicit = explicitCurveSubpath(path);
  if (explicit.segments[segmentIndex] === undefined) return null;
  return removeCurveRange(explicit, { segmentIndex, t: 0 }, { segmentIndex, t: 1 });
}

/** Open the path at a node so both sides end there as separate open ends. A
 *  closed path becomes one open path starting and ending at the node; an open
 *  path splits into two. Null at an open end, where there is nothing to break. */
export function breakCurveSubpathAtNode(
  path: CurveSubpath,
  nodeIndex: number,
): ReadonlyArray<CurveSubpath> | null {
  const explicit = explicitCurveSubpath(path);
  const count = explicit.segments.length;
  if (!Number.isInteger(nodeIndex) || count === 0) return null;
  if (explicit.closed) {
    if (nodeIndex < 0 || nodeIndex >= count) return null;
    const start = segmentStartPoint(explicit, nodeIndex) as Vec2;
    const segments = [
      ...explicit.segments.slice(nodeIndex),
      ...explicit.segments.slice(0, nodeIndex),
    ];
    return [{ start, segments, closed: false }];
  }
  if (nodeIndex <= 0 || nodeIndex >= count) return null;
  return [
    { start: explicit.start, segments: explicit.segments.slice(0, nodeIndex), closed: false },
    {
      start: segmentStartPoint(explicit, nodeIndex) as Vec2,
      segments: explicit.segments.slice(nodeIndex),
      closed: false,
    },
  ];
}

/** Cut out the stretch that runs forward from `from` to `to`. On an open path
 *  `from` precedes `to` and the pieces before and after survive; on a closed
 *  path the rest of the loop survives as one open path starting at `to`.
 *  Equal positions on a closed path cut nothing and just open it there. */
export function removeCurveRange(
  path: CurveSubpath,
  from: CurvePosition,
  to: CurvePosition,
): ReadonlyArray<CurveSubpath> {
  const explicit = explicitCurveSubpath(path);
  if (explicit.closed) {
    const kept = keptLoop(explicit, from, to);
    return kept === null ? [] : [kept];
  }
  const end: CurvePosition = { segmentIndex: explicit.segments.length - 1, t: 1 };
  return [
    sliceSegments(explicit.start, explicit.segments, { segmentIndex: 0, t: 0 }, from),
    sliceSegments(explicit.start, explicit.segments, to, end),
  ].filter((piece): piece is CurveSubpath => piece !== null);
}

/** The open subpath between two positions of an open run (`from` before `to`). */
export function sliceOpenCurve(
  path: CurveSubpath,
  from: CurvePosition,
  to: CurvePosition,
): CurveSubpath | null {
  const explicit = explicitCurveSubpath(path);
  return sliceSegments(explicit.start, explicit.segments, from, to);
}

export function comparePositions(a: CurvePosition, b: CurvePosition): number {
  return a.segmentIndex + a.t - (b.segmentIndex + b.t);
}

// The loop from `to` forward to `from`, unrolled into an open run that starts
// at `to`'s segment and repeats that segment at the end, so a kept stretch
// that wraps back into its own starting segment is still one slice.
function keptLoop(
  explicit: CurveSubpath,
  from: CurvePosition,
  to: CurvePosition,
): CurveSubpath | null {
  const count = explicit.segments.length;
  const first = to.segmentIndex;
  const start = segmentStartPoint(explicit, first);
  const firstSegment = explicit.segments[first];
  if (start === null || firstSegment === undefined) return null;
  const unrolled = [
    ...explicit.segments.slice(first),
    ...explicit.segments.slice(0, first),
    firstSegment,
  ];
  let last = (from.segmentIndex - first + count) % count;
  if (last === 0 && from.t <= to.t) last = count;
  return sliceSegments(
    start,
    unrolled,
    { segmentIndex: 0, t: to.t },
    { segmentIndex: last, t: from.t },
  );
}

function sliceSegments(
  start: Vec2,
  segments: ReadonlyArray<PathSegment>,
  from: CurvePosition,
  to: CurvePosition,
): CurveSubpath | null {
  const kept: PathSegment[] = [];
  let sliceStart: Vec2 | null = null;
  for (let index = from.segmentIndex; index <= to.segmentIndex; index += 1) {
    const segment = segments[index];
    const segmentFrom = index === 0 ? start : segments[index - 1]?.to;
    if (segment === undefined || segmentFrom === undefined) return null;
    const t0 = index === from.segmentIndex ? snapParameter(from.t) : 0;
    const t1 = index === to.segmentIndex ? snapParameter(to.t) : 1;
    if (t1 - t0 <= SEGMENT_PARAMETER_EPSILON) continue;
    const piece = segmentPiece(segmentFrom, segment, t0, t1);
    sliceStart ??= piece.from;
    kept.push(piece.segment);
  }
  if (sliceStart === null || kept.length === 0) return null;
  return { start: sliceStart, segments: kept, closed: false };
}

function snapParameter(t: number): number {
  if (!(t > SEGMENT_PARAMETER_EPSILON)) return 0;
  return t >= 1 - SEGMENT_PARAMETER_EPSILON ? 1 : t;
}

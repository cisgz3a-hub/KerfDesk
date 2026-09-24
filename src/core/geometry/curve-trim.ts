// curve-trim — LightBurn's Trim (T) for canonical curve paths (ADR-376):
// "cut line under mouse back to the next place it intersects with another
// line" (https://docs.lightburnsoftware.com/2.1/Reference/EditNodes/). The
// stretch around the cursor is removed up to the nearest crossing on each side,
// walking along the path through nodes. An open path's own end also stops the
// walk, so a line overshooting a crossing trims back to it. Crossings with the
// path itself count too.
//
// Crossings are found on the path sampled finely in the caller's shared space
// (scene millimetres for artwork), then cut exactly on the stored curve at the
// matching parameter, so the kept pieces keep their original geometry.
//
// Pure core — no I/O, no globals, deterministic.

import type { CurveSubpath, Vec2 } from '../scene';
import { explicitCurveSubpath, sampleSegment, segmentStartPoint } from './curve-segment-geometry';
import { removeCurveRange, sliceOpenCurve, type CurvePosition } from './curve-subpath-topology';

/** A polyline in the shared space; a closed outline repeats its first point. */
export type TrimCutter = ReadonlyArray<Vec2>;

export type CurveTrimResult =
  | { readonly kind: 'trimmed'; readonly pieces: ReadonlyArray<CurveSubpath> }
  | { readonly kind: 'no-crossing' };

type ChainPoint = { readonly s: number; readonly point: Vec2 };
type Edge = {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly minX: number;
  readonly maxX: number;
  // Index along the path chain, or -1 for a cutter edge.
  readonly chainIndex: number;
  readonly s0: number;
  readonly s1: number;
};

const PARAMETER_EPSILON = 1e-9;
const END_EPSILON = 1e-6;

export function trimCurveSubpath(args: {
  readonly path: CurveSubpath;
  readonly cursor: CurvePosition;
  readonly toShared: (point: Vec2) => Vec2;
  readonly cutters: ReadonlyArray<TrimCutter>;
  readonly tolerance: number;
}): CurveTrimResult {
  const path = explicitCurveSubpath(args.path);
  const count = path.segments.length;
  if (count === 0) return { kind: 'no-crossing' };
  const chain = pathChain(path, args.toShared, args.tolerance);
  const crossings = crossingParameters(chain, args.cutters, path.closed);
  const cursor = args.cursor.segmentIndex + args.cursor.t;
  // A crossing at an open end would trim nothing; the end already stops the walk.
  const others = crossings.filter(
    (s) =>
      Math.abs(s - cursor) > PARAMETER_EPSILON &&
      (path.closed || (s > END_EPSILON && s < count - END_EPSILON)),
  );
  const before = others.filter((s) => s < cursor).at(-1);
  const after = others.find((s) => s > cursor);
  if (path.closed) return trimClosed(path, others, before, after);
  if (before === undefined && after === undefined) return { kind: 'no-crossing' };
  const pieces = [
    before === undefined ? null : sliceOpenCurve(path, start(), position(before, count)),
    after === undefined ? null : sliceOpenCurve(path, position(after, count), end(count)),
  ].filter((piece): piece is CurveSubpath => piece !== null);
  return { kind: 'trimmed', pieces };
}

function trimClosed(
  path: CurveSubpath,
  crossings: ReadonlyArray<number>,
  before: number | undefined,
  after: number | undefined,
): CurveTrimResult {
  // One crossing cannot bound a stretch of a loop; the walk wraps past the seam.
  const from = before ?? crossings.at(-1);
  const to = after ?? crossings[0];
  if (crossings.length < 2 || from === undefined || to === undefined || from === to) {
    return { kind: 'no-crossing' };
  }
  const count = path.segments.length;
  return {
    kind: 'trimmed',
    pieces: removeCurveRange(path, position(from, count), position(to, count)),
  };
}

function pathChain(
  path: CurveSubpath,
  toShared: (point: Vec2) => Vec2,
  tolerance: number,
): ReadonlyArray<ChainPoint> {
  const chain: ChainPoint[] = [];
  path.segments.forEach((segment, index) => {
    const from = segmentStartPoint(path, index) as Vec2;
    const samples = sampleSegment(from, segment, tolerance);
    samples.forEach((sample, sampleIndex) => {
      if (index > 0 && sampleIndex === 0) return;
      chain.push({ s: index + sample.t, point: toShared(sample.point) });
    });
  });
  return chain;
}

// Every path parameter where the path crosses a cutter or itself, sorted and
// with near-duplicates (a crossing exactly on a shared vertex) merged.
function crossingParameters(
  chain: ReadonlyArray<ChainPoint>,
  cutters: ReadonlyArray<TrimCutter>,
  closed: boolean,
): ReadonlyArray<number> {
  const pathEdges = chainEdges(chain);
  const edges = [...pathEdges, ...cutters.flatMap(cutterEdges)].sort((a, b) => a.minX - b.minX);
  const lastChainIndex = pathEdges.length - 1;
  const found: number[] = [];
  let active: Edge[] = [];
  for (const edge of edges) {
    active = active.filter((candidate) => candidate.maxX >= edge.minX);
    for (const other of active) {
      if (edge.chainIndex < 0 && other.chainIndex < 0) continue;
      if (adjacentOnPath(edge, other, lastChainIndex, closed)) continue;
      addCrossing(found, edge, other);
    }
    active.push(edge);
  }
  found.sort((a, b) => a - b);
  return found.filter((s, index) => index === 0 || s - (found[index - 1] as number) > 1e-7);
}

function addCrossing(found: number[], first: Edge, second: Edge): void {
  const hit = edgeIntersection(first, second);
  if (hit === null) return;
  if (first.chainIndex >= 0) found.push(first.s0 + (first.s1 - first.s0) * hit.u);
  if (second.chainIndex >= 0) found.push(second.s0 + (second.s1 - second.s0) * hit.v);
}

// Neighbouring path edges share a vertex, which is not a crossing; on a closed
// path the first and last edges meet at the seam.
function adjacentOnPath(a: Edge, b: Edge, lastChainIndex: number, closed: boolean): boolean {
  if (a.chainIndex < 0 || b.chainIndex < 0) return false;
  const gap = Math.abs(a.chainIndex - b.chainIndex);
  return gap <= 1 || (closed && gap === lastChainIndex);
}

function chainEdges(chain: ReadonlyArray<ChainPoint>): Edge[] {
  const edges: Edge[] = [];
  for (let index = 1; index < chain.length; index += 1) {
    const a = chain[index - 1] as ChainPoint;
    const b = chain[index] as ChainPoint;
    // A zero-length edge would make its two neighbours look non-adjacent, and
    // their shared vertex would then read as a self-crossing.
    if (a.point.x === b.point.x && a.point.y === b.point.y) continue;
    edges.push(edge(a.point, b.point, edges.length, a.s, b.s));
  }
  return edges;
}

function cutterEdges(cutter: TrimCutter): Edge[] {
  const edges: Edge[] = [];
  for (let index = 1; index < cutter.length; index += 1) {
    edges.push(edge(cutter[index - 1] as Vec2, cutter[index] as Vec2, -1, 0, 0));
  }
  return edges;
}

function edge(a: Vec2, b: Vec2, chainIndex: number, s0: number, s1: number): Edge {
  return { a, b, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), chainIndex, s0, s1 };
}

function edgeIntersection(first: Edge, second: Edge): { u: number; v: number } | null {
  const rx = first.b.x - first.a.x;
  const ry = first.b.y - first.a.y;
  const sx = second.b.x - second.a.x;
  const sy = second.b.y - second.a.y;
  const denominator = rx * sy - ry * sx;
  const scale = Math.hypot(rx, ry) * Math.hypot(sx, sy);
  // Parallel or overlapping edges share no single crossing point.
  if (scale === 0 || Math.abs(denominator) <= scale * 1e-12) return null;
  const qx = second.a.x - first.a.x;
  const qy = second.a.y - first.a.y;
  const u = (qx * sy - qy * sx) / denominator;
  const v = (qx * ry - qy * rx) / denominator;
  const slack = 1e-12;
  if (u < -slack || u > 1 + slack || v < -slack || v > 1 + slack) return null;
  return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
}

function position(s: number, count: number): CurvePosition {
  const segmentIndex = Math.min(count - 1, Math.max(0, Math.floor(s)));
  return { segmentIndex, t: Math.min(1, Math.max(0, s - segmentIndex)) };
}

function start(): CurvePosition {
  return { segmentIndex: 0, t: 0 };
}

function end(count: number): CurvePosition {
  return { segmentIndex: count - 1, t: 1 };
}

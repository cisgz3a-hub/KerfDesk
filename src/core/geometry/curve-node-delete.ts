// curve-node-delete — Edit Nodes Delete on canonical curve subpaths. As in
// LightBurn, deleting nodes combines the adjacent segments. Lines combine into
// their chord, exactly like the polyline Delete. Anything curved becomes ONE
// cubic least-squares fitted to the removed segments, so the outline keeps its
// shape as closely as one cubic can; the naive reconnect through the outer
// handles visibly flattens the curve. The fit keeps the outer handle
// directions, so the joins stay smooth, unless that misses the removed curve
// by more than a small share of its size (ADR-371 Amendment 1).
//
// Pure core — no I/O, no globals, deterministic.

import {
  assertNever,
  curveNodeCount,
  flattenCurveSubpath,
  type CurveSubpath,
  type EllipticalArcPathSegment,
  type PathSegment,
  type Vec2,
} from '../scene';
import { ellipticalArcEndDirection } from '../scene/curve-path';
import { evaluateCubic, fitCubicWithTangents, type CubicBezier } from './cubic-fit';
import { fitCubicFree } from './cubic-fit-free';

// The polyline Delete's floors: an open run keeps one segment, a ring a triangle.
const MIN_OPEN_NODES = 2;
const MIN_CLOSED_NODES = 3;
const FIT_SAMPLES_PER_SEGMENT = 24;
// The share of the removed segments' size (their reach from the first kept
// node) the smooth-join fit may miss them by before the handles turn freely.
// A node of a four-node circle misses by 0.7% of it; a hump crest by 50%.
const FIT_TOLERANCE_RATIO = 0.02;
const MISS_SAMPLES_PER_SAMPLE = 4;
// Flatten tolerances relative to the geometry's size: fine enough for the fit
// to see the true curve, far inside the flattening segment budget.
const SAMPLE_TOLERANCE_RATIO = 1e-4;
const EPSILON = 1e-9;

type Piece = { readonly from: Vec2; readonly segment: PathSegment };

/** Remove the given anchors and reconnect the path around them. Returns the
 *  path itself when no index names an anchor, and null when fewer anchors would
 *  remain than the polyline Delete allows. A closed result ends on its start. */
export function deleteCurveNodes(
  path: CurveSubpath,
  nodeIndices: ReadonlySet<number>,
): CurveSubpath | null {
  const nodeCount = curveNodeCount(path);
  const kept = Array.from({ length: nodeCount }, (_, index) => index).filter(
    (index) => !nodeIndices.has(index),
  );
  if (kept.length === nodeCount) return path;
  if (kept.length < (path.closed ? MIN_CLOSED_NODES : MIN_OPEN_NODES)) return null;
  const segments = explicitlyClosedSegments(path, nodeCount);
  const anchors = [path.start, ...segments.map((segment) => segment.to)];
  const merged: PathSegment[] = [];
  const runCount = path.closed ? kept.length : kept.length - 1;
  for (let run = 0; run < runCount; run += 1) {
    const from = kept[run] as number;
    const to = kept[(run + 1) % kept.length] as number;
    const removed = Array.from(
      { length: (to - from + nodeCount) % nodeCount },
      (_, offset) => segments[(from + offset) % segments.length] as PathSegment,
    );
    const segment = mergeRun(anchors[from] as Vec2, removed);
    if (segment === null) return null;
    merged.push(segment);
  }
  return { start: anchors[kept[0] as number] as Vec2, segments: merged, closed: path.closed };
}

// A ring whose last segment stops short of the start closes implicitly; the
// closing line becomes a real segment so a run can merge across it.
function explicitlyClosedSegments(
  path: CurveSubpath,
  nodeCount: number,
): ReadonlyArray<PathSegment> {
  if (!path.closed || nodeCount !== path.segments.length + 1) return path.segments;
  return [...path.segments, { kind: 'line', to: path.start }];
}

// One segment standing in for the run between two kept anchors. Zero-length
// pieces, such as an SVG `Z` drawn back onto the start, carry no shape.
function mergeRun(from: Vec2, run: ReadonlyArray<PathSegment>): PathSegment | null {
  const only = run.length === 1 ? run[0] : undefined;
  if (only !== undefined) return only;
  const end = run.at(-1)?.to ?? from;
  const pieces = shapedPieces(from, run);
  const single = pieces.length === 1 ? pieces[0] : undefined;
  if (single !== undefined) return { ...single.segment, to: end };
  if (pieces.every((piece) => piece.segment.kind === 'line')) return { kind: 'line', to: end };
  return fittedCubic(from, end, run, pieces);
}

function shapedPieces(from: Vec2, run: ReadonlyArray<PathSegment>): Piece[] {
  const pieces: Piece[] = [];
  let current = from;
  for (const segment of run) {
    const reach =
      segment.kind === 'cubic' ? [segment.control1, segment.control2, segment.to] : [segment.to];
    if (firstDirection(current, reach) !== null) pieces.push({ from: current, segment });
    current = segment.to;
  }
  return pieces;
}

// The cubic that keeps the outer tangent directions leaves the joins with the
// kept segments smooth. When both directions lie along the chord, as at a hump
// or a wave crest, every control point sits on the chord and no handle length
// can follow the curve. Past the tolerance the handles turn freely instead, as
// long as that at least halves the miss (ADR-371 Amendment 1).
function fittedCubic(
  from: Vec2,
  end: Vec2,
  run: ReadonlyArray<PathSegment>,
  pieces: ReadonlyArray<Piece>,
): PathSegment | null {
  const first = pieces[0];
  const last = pieces.at(-1);
  if (first === undefined || last === undefined) return null;
  const tangentStart = pieceTangent(first, 'start');
  const tangentEnd = pieceTangent(last, 'end');
  const samples = runSamples(from, end, run, FIT_SAMPLES_PER_SEGMENT * pieces.length);
  if (tangentStart === null || tangentEnd === null || samples === null) return null;
  const kept = finiteCubic(fitCubicWithTangents(samples, tangentStart, tangentEnd));
  const keptMiss = kept === null ? Number.POSITIVE_INFINITY : cubicMiss(samples, kept);
  let cubic = kept;
  if (keptMiss > controlExtent(from, run) * FIT_TOLERANCE_RATIO) {
    const free = finiteCubic(fitCubicFree(samples));
    if (free !== null && cubicMiss(samples, free) < keptMiss / 2) cubic = free;
  }
  if (cubic === null) return null;
  return { kind: 'cubic', control1: cubic.p1, control2: cubic.p2, to: end };
}

function finiteCubic(cubic: CubicBezier | null): CubicBezier | null {
  return cubic !== null && finitePoint(cubic.p1) && finitePoint(cubic.p2) ? cubic : null;
}

// How far the fitted cubic and the removed segments' samples stray from each
// other, both ways: the cubic could also bulge away between samples.
function cubicMiss(samples: ReadonlyArray<Vec2>, cubic: CubicBezier): number {
  const count = samples.length * MISS_SAMPLES_PER_SAMPLE;
  const traced = Array.from({ length: count + 1 }, (_, index) =>
    evaluateCubic(cubic, index / count),
  );
  let miss = 0;
  for (const point of samples) miss = Math.max(miss, distanceToPolyline(point, traced));
  for (const point of traced) miss = Math.max(miss, distanceToPolyline(point, samples));
  return miss;
}

function distanceToPolyline(point: Vec2, line: ReadonlyArray<Vec2>): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1] as Vec2;
    const b = line[index] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq > 0
        ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq))
        : 0;
    nearest = Math.min(nearest, distance(point, { x: a.x + dx * t, y: a.y + dy * t }));
  }
  return nearest;
}

// Evenly spaced by arc length and ending exactly on both anchors, so the
// fitter's chord-length parameterization tracks the real curve.
function runSamples(
  from: Vec2,
  end: Vec2,
  run: ReadonlyArray<PathSegment>,
  count: number,
): Vec2[] | null {
  const flattened = flattenCurveSubpath(
    { start: from, segments: run, closed: false },
    { toleranceMm: Math.max(controlExtent(from, run) * SAMPLE_TOLERANCE_RATIO, EPSILON) },
  );
  if (flattened.kind !== 'ok') return null;
  const points = flattened.polyline.points;
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] as Vec2;
    lengths.push((lengths[index - 1] as number) + distance(previous, points[index] as Vec2));
  }
  const total = lengths.at(-1) ?? 0;
  const samples = [from];
  let index = 1;
  for (let sample = 1; sample < count; sample += 1) {
    const target = (total * sample) / count;
    while (index < points.length - 1 && (lengths[index] as number) < target) index += 1;
    samples.push(pointAtLength(points, lengths, index, target));
  }
  samples.push(end);
  return samples;
}

function pointAtLength(
  points: ReadonlyArray<Vec2>,
  lengths: ReadonlyArray<number>,
  index: number,
  target: number,
): Vec2 {
  const a = points[index - 1] as Vec2;
  const b = points[index] as Vec2;
  const startLength = lengths[index - 1] as number;
  const span = (lengths[index] as number) - startLength;
  const t = span > 0 ? Math.min(1, Math.max(0, (target - startLength) / span)) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function controlExtent(from: Vec2, run: ReadonlyArray<PathSegment>): number {
  let extent = 0;
  for (const segment of run) {
    const reach =
      segment.kind === 'cubic' ? [segment.control1, segment.control2, segment.to] : [segment.to];
    for (const point of reach) extent = Math.max(extent, distance(from, point));
  }
  return extent;
}

// The unit tangent leaving the piece's start, or pointing back into the piece
// from its end: the orientation fitCubicWithTangents expects for each arm.
function pieceTangent(piece: Piece, side: 'start' | 'end'): Vec2 | null {
  const { from, segment } = piece;
  switch (segment.kind) {
    case 'line':
      return side === 'start' ? direction(from, segment.to) : direction(segment.to, from);
    case 'cubic':
      return side === 'start'
        ? firstDirection(from, [segment.control1, segment.control2, segment.to])
        : firstDirection(segment.to, [segment.control2, segment.control1, from]);
    case 'elliptical-arc':
      return arcTangent(from, segment, side);
    default:
      return assertNever(segment, 'PathSegment');
  }
}

// Arcs store no handles. Take the tangent analytically from the arc's centre
// parametrisation: the flattener spaces its samples to fit the tolerance, not
// at equal angles, so a finite difference over them is not second-order.
function arcTangent(from: Vec2, arc: EllipticalArcPathSegment, side: 'start' | 'end'): Vec2 | null {
  const tangent = ellipticalArcEndDirection(from, arc, side);
  return tangent === null ? null : direction({ x: 0, y: 0 }, tangent);
}

function firstDirection(from: Vec2, targets: ReadonlyArray<Vec2>): Vec2 | null {
  for (const target of targets) {
    const tangent = direction(from, target);
    if (tangent !== null) return tangent;
  }
  return null;
}

function direction(from: Vec2, to: Vec2): Vec2 | null {
  const length = distance(from, to);
  return length <= EPSILON ? null : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

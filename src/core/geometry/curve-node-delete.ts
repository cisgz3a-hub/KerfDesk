// curve-node-delete — Edit Nodes Delete on canonical curve subpaths. As in
// LightBurn, deleting nodes combines the adjacent segments. Lines combine into
// their chord, exactly like the polyline Delete. Anything curved becomes ONE
// cubic that keeps the outer handle directions and least-squares fits the two
// handle lengths to the removed segments, so the outline keeps its shape; the
// naive reconnect through the outer handles visibly flattens the curve.
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
import { fitCubicWithTangents } from './cubic-fit';

// The polyline Delete's floors: an open run keeps one segment, a ring a triangle.
const MIN_OPEN_NODES = 2;
const MIN_CLOSED_NODES = 3;
const FIT_SAMPLES_PER_SEGMENT = 24;
// Flatten tolerances relative to the geometry's size: fine enough for the fit
// to see the true curve, far inside the flattening segment budget.
const SAMPLE_TOLERANCE_RATIO = 1e-4;
const ARC_TANGENT_TOLERANCE_RATIO = 1e-5;
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
  const cubic = fitCubicWithTangents(samples, tangentStart, tangentEnd);
  if (cubic === null || !finitePoint(cubic.p1) || !finitePoint(cubic.p2)) return null;
  return { kind: 'cubic', control1: cubic.p1, control2: cubic.p2, to: end };
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

// Arcs store no handles. Read the tangent off the canonical flattener's
// uniform-angle samples with a one-sided second-order difference, so it
// matches the arc exactly as preview and output draw it.
function arcTangent(from: Vec2, arc: EllipticalArcPathSegment, side: 'start' | 'end'): Vec2 | null {
  const radius = Math.max(Math.abs(arc.radiusX), Math.abs(arc.radiusY), distance(from, arc.to) / 2);
  const flattened = flattenCurveSubpath(
    { start: from, segments: [arc], closed: false },
    { toleranceMm: radius * ARC_TANGENT_TOLERANCE_RATIO },
  );
  if (flattened.kind !== 'ok') return null;
  const points = flattened.polyline.points;
  const [p0, p1, p2] = side === 'start' ? points : [...points].reverse();
  if (p0 === undefined || p1 === undefined) return null;
  if (p2 === undefined) return direction(p0, p1);
  return direction(p0, {
    x: p0.x + 4 * (p1.x - p0.x) - (p2.x - p0.x),
    y: p0.y + 4 * (p1.y - p0.y) - (p2.y - p0.y),
  });
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

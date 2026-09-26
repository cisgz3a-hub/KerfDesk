// The trace preview's Show Points markers: the vector's real nodes, the
// anchors a user edits after commit. Canonical curves (ColoredPath.curves)
// give each subpath's start plus every segment's end point, so the marker
// count follows Optimize and Smoothness. A path without curves has only its
// compatibility polyline, whose samples are the only points it can show.
// Control handles are not markers (ADR-447).

import type { ColoredPath, CurveSubpath, PathSegment, Vec2 } from '../../core/scene';

/** How a node is drawn: a curve anchor where the neighbouring tangents break
 *  (or a line meets a line, or an open end) is a corner; a curve anchor with
 *  matching tangents is a smooth (G1) node; a polyline sample has no known
 *  joint type. */
export type TraceNodeKind = 'corner' | 'smooth' | 'sample';

const NODE_KIND_CODE: Readonly<Record<TraceNodeKind, number>> = {
  corner: 0,
  smooth: 1,
  sample: 2,
};
export const TRACE_NODE_KINDS: ReadonlyArray<TraceNodeKind> = ['corner', 'smooth', 'sample'];

/** Flat, cache-friendly node list: x/y pairs and a kind code per node. */
export type TraceNodes = {
  readonly count: number;
  readonly coordinates: Float64Array;
  readonly kinds: Uint8Array;
};

// Tangents within ~2 degrees read as one smooth joint. The fitter's G1 joints
// sit far inside this; deliberate corners sit far outside it.
const SMOOTH_COS = Math.cos((2 * Math.PI) / 180);
const EPSILON = 1e-9;

const cache = new WeakMap<ReadonlyArray<ColoredPath>, TraceNodes>();

/** The nodes for one preview result, built once per paths array so a
 *  viewport repaint only walks a flat typed array. */
export function traceNodes(paths: ReadonlyArray<ColoredPath>): TraceNodes {
  const cached = cache.get(paths);
  if (cached !== undefined) return cached;
  const count = traceNodeCount(paths);
  const coordinates = new Float64Array(count * 2);
  const kinds = new Uint8Array(count);
  let index = 0;
  const push = (point: Vec2, kind: TraceNodeKind): void => {
    coordinates[index * 2] = point.x;
    coordinates[index * 2 + 1] = point.y;
    kinds[index] = NODE_KIND_CODE[kind];
    index += 1;
  };
  for (const path of paths) {
    if (path.curves !== undefined) {
      for (const curve of path.curves) visitCurveNodes(curve, push);
    } else {
      for (const polyline of path.polylines) {
        const last = polylineNodeLength(polyline.points, polyline.closed);
        for (let i = 0; i < last; i += 1) push(polyline.points[i] as Vec2, 'sample');
      }
    }
  }
  const nodes = { count, coordinates, kinds };
  cache.set(paths, nodes);
  return nodes;
}

/** Node count for the status line; matches what Show Points paints. */
export function traceNodeCount(paths: ReadonlyArray<ColoredPath>): number {
  const cached = cache.get(paths);
  if (cached !== undefined) return cached.count;
  let count = 0;
  for (const path of paths) {
    if (path.curves !== undefined) {
      for (const curve of path.curves) count += curveNodeTotal(curve);
    } else {
      for (const polyline of path.polylines) {
        count += polylineNodeLength(polyline.points, polyline.closed);
      }
    }
  }
  return count;
}

function curveNodeTotal(curve: CurveSubpath): number {
  return curve.segments.length + (closesOnStart(curve) ? 0 : 1);
}

function closesOnStart(curve: CurveSubpath): boolean {
  const last = curve.segments.at(-1)?.to;
  return curve.closed && last !== undefined && samePoint(last, curve.start);
}

function polylineNodeLength(points: ReadonlyArray<Vec2>, closed: boolean): number {
  const first = points[0];
  const last = points.at(-1);
  return closed && points.length > 1 && first !== undefined && last !== undefined
    ? points.length - (samePoint(first, last) ? 1 : 0)
    : points.length;
}

function visitCurveNodes(
  curve: CurveSubpath,
  push: (point: Vec2, kind: TraceNodeKind) => void,
): void {
  // A closed subpath that stops short of its start closes with an implicit
  // straight edge; that edge is a real neighbour of the first and last nodes.
  const implicitClose = curve.closed && curve.segments.length > 0 && !closesOnStart(curve);
  const segments: ReadonlyArray<PathSegment> = implicitClose
    ? [...curve.segments, { kind: 'line', to: curve.start }]
    : curve.segments;
  const route = { start: curve.start, segments };
  const total = curveNodeTotal(curve);
  const wraps = curve.closed && segments.length > 0;
  for (let node = 0; node < total; node += 1) {
    const point = node === 0 ? curve.start : (segments[node - 1] as PathSegment).to;
    const incomingIndex = node > 0 ? node - 1 : wraps ? segments.length - 1 : -1;
    const outgoingIndex = node < segments.length ? node : -1;
    const kind =
      incomingIndex < 0 || outgoingIndex < 0
        ? 'corner'
        : jointKind(route, incomingIndex, outgoingIndex);
    push(point, kind);
  }
}

type Route = { readonly start: Vec2; readonly segments: ReadonlyArray<PathSegment> };

function jointKind(route: Route, incomingIndex: number, outgoingIndex: number): TraceNodeKind {
  const incoming = route.segments[incomingIndex] as PathSegment;
  const outgoing = route.segments[outgoingIndex] as PathSegment;
  if (incoming.kind === 'line' && outgoing.kind === 'line') return 'corner';
  const before = segmentTangents(segmentStart(route, incomingIndex), incoming).end;
  const after = segmentTangents(segmentStart(route, outgoingIndex), outgoing).start;
  const lengths = Math.hypot(before.x, before.y) * Math.hypot(after.x, after.y);
  if (lengths <= EPSILON) return 'corner';
  return (before.x * after.x + before.y * after.y) / lengths >= SMOOTH_COS ? 'smooth' : 'corner';
}

function segmentStart(route: Route, index: number): Vec2 {
  return index === 0 ? route.start : (route.segments[index - 1] as PathSegment).to;
}

type Tangents = { readonly start: Vec2; readonly end: Vec2 };

/** Direction of travel leaving `from` and arriving at the segment's end. */
function segmentTangents(from: Vec2, segment: PathSegment): Tangents {
  const chord = difference(segment.to, from);
  switch (segment.kind) {
    case 'line':
      return { start: chord, end: chord };
    case 'cubic':
      return {
        start: firstNonZero(
          difference(segment.control1, from),
          difference(segment.control2, from),
          chord,
        ),
        end: firstNonZero(
          difference(segment.to, segment.control2),
          difference(segment.to, segment.control1),
          chord,
        ),
      };
    case 'elliptical-arc':
      return arcTangents(from, segment) ?? { start: chord, end: chord };
  }
}

/** End tangents of an SVG elliptical arc via its centre parameterization. */
function arcTangents(
  from: Vec2,
  arc: Extract<PathSegment, { readonly kind: 'elliptical-arc' }>,
): Tangents | null {
  let rx = Math.abs(arc.radiusX);
  let ry = Math.abs(arc.radiusY);
  if (rx <= EPSILON || ry <= EPSILON || samePoint(from, arc.to)) return null;
  const phi = (arc.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - arc.to.x) / 2;
  const dy = (from.y - arc.to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const root = denominator <= EPSILON ? 0 : Math.sqrt(Math.max(0, numerator / denominator));
  const coefficient = arc.largeArc === arc.sweep ? -root : root;
  const cx = (coefficient * rx * y1) / ry;
  const cy = (-coefficient * ry * x1) / rx;
  const direction = arc.sweep ? 1 : -1;
  const tangentAt = (ux: number, uy: number): Vec2 => {
    // d/dθ (rx cosθ, ry sinθ) with (cosθ, sinθ) = (ux, uy), then rotate by phi.
    const tx = -rx * uy * direction;
    const ty = ry * ux * direction;
    return { x: cos * tx - sin * ty, y: sin * tx + cos * ty };
  };
  return {
    start: tangentAt((x1 - cx) / rx, (y1 - cy) / ry),
    end: tangentAt((-x1 - cx) / rx, (-y1 - cy) / ry),
  };
}

function firstNonZero(...candidates: ReadonlyArray<Vec2>): Vec2 {
  for (const candidate of candidates) {
    if (Math.abs(candidate.x) > EPSILON || Math.abs(candidate.y) > EPSILON) return candidate;
  }
  return { x: 0, y: 0 };
}

function difference(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

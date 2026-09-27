// The trace preview's Show Points markers: the vector's real nodes, the
// anchors a user edits after commit. Canonical curves (ColoredPath.curves)
// give each subpath's start plus every segment's end point, so the marker
// count follows Optimize (and Smoothness only where it changes the fitted
// segments; see ADR-447). A path without curves has only its
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
  /** x/y pairs; single precision is ample for view-only markers. */
  readonly coordinates: Float32Array;
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
  const coordinates = new Float32Array(count * 2);
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

/** Node count for the status line: the node set Show Points paints before
 *  density thinning merges markers that share a screen cell. */
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
  const { segments } = curve;
  const closing = implicitClosingEdge(curve);
  const route: Route = { start: curve.start, segments, closing };
  const routeLength = segments.length + (closing === null ? 0 : 1);
  const total = curveNodeTotal(curve);
  const wraps = curve.closed && routeLength > 0;
  for (let node = 0; node < total; node += 1) {
    const point = node === 0 ? curve.start : (segments[node - 1] as PathSegment).to;
    const incomingIndex = node > 0 ? node - 1 : wraps ? routeLength - 1 : -1;
    const outgoingIndex = node < routeLength ? node : -1;
    const kind =
      incomingIndex < 0 || outgoingIndex < 0
        ? 'corner'
        : jointKind(route, incomingIndex, outgoingIndex);
    push(point, kind);
  }
}

/** A closed subpath that stops short of its start closes with an implicit
 *  straight edge; that edge is a real neighbour of the first and last nodes.
 *  It is indexed virtually (one object per subpath) rather than copied in. */
function implicitClosingEdge(curve: CurveSubpath): PathSegment | null {
  return curve.closed && curve.segments.length > 0 && !closesOnStart(curve)
    ? { kind: 'line', to: curve.start }
    : null;
}

type Route = {
  readonly start: Vec2;
  readonly segments: ReadonlyArray<PathSegment>;
  /** The implicit closing edge, at index segments.length; null when none. */
  readonly closing: PathSegment | null;
};

type MutableVec = { x: number; y: number };

// Scratch tangents reused for every joint: a huge trace builds its node list
// without allocating per joint.
const incomingTangent: MutableVec = { x: 0, y: 0 };
const outgoingTangent: MutableVec = { x: 0, y: 0 };

function jointKind(route: Route, incomingIndex: number, outgoingIndex: number): TraceNodeKind {
  const incoming = routeSegment(route, incomingIndex);
  const outgoing = routeSegment(route, outgoingIndex);
  if (incoming.kind === 'line' && outgoing.kind === 'line') return 'corner';
  setEndTangent(segmentStart(route, incomingIndex), incoming, incomingTangent);
  setStartTangent(segmentStart(route, outgoingIndex), outgoing, outgoingTangent);
  const before = incomingTangent;
  const after = outgoingTangent;
  const lengths = Math.hypot(before.x, before.y) * Math.hypot(after.x, after.y);
  if (lengths <= EPSILON) return 'corner';
  return (before.x * after.x + before.y * after.y) / lengths >= SMOOTH_COS ? 'smooth' : 'corner';
}

function routeSegment(route: Route, index: number): PathSegment {
  return index < route.segments.length
    ? (route.segments[index] as PathSegment)
    : (route.closing as PathSegment);
}

function segmentStart(route: Route, index: number): Vec2 {
  return index === 0 ? route.start : routeSegment(route, index - 1).to;
}

/** Direction of travel leaving `from` along the segment. */
function setStartTangent(from: Vec2, segment: PathSegment, out: MutableVec): void {
  switch (segment.kind) {
    case 'line':
      setDirection(out, segment.to, from);
      return;
    case 'cubic':
      if (setDirection(out, segment.control1, from)) return;
      if (setDirection(out, segment.control2, from)) return;
      setDirection(out, segment.to, from);
      return;
    case 'elliptical-arc':
      setArcTangent(from, segment, out, 'start');
      return;
  }
}

/** Direction of travel arriving at the segment's end. */
function setEndTangent(from: Vec2, segment: PathSegment, out: MutableVec): void {
  switch (segment.kind) {
    case 'line':
      setDirection(out, segment.to, from);
      return;
    case 'cubic':
      if (setDirection(out, segment.to, segment.control2)) return;
      if (setDirection(out, segment.to, segment.control1)) return;
      setDirection(out, segment.to, from);
      return;
    case 'elliptical-arc':
      setArcTangent(from, segment, out, 'end');
      return;
  }
}

function setArcTangent(
  from: Vec2,
  arc: Extract<PathSegment, { readonly kind: 'elliptical-arc' }>,
  out: MutableVec,
  end: 'start' | 'end',
): void {
  const tangents = arcTangents(from, arc);
  if (tangents === null) {
    setDirection(out, arc.to, from);
    return;
  }
  out.x = tangents[end].x;
  out.y = tangents[end].y;
}

type Tangents = { readonly start: Vec2; readonly end: Vec2 };

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

/** Sets `out` to a - b; true when that direction is not degenerate. */
function setDirection(out: MutableVec, a: Vec2, b: Vec2): boolean {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return Math.abs(out.x) > EPSILON || Math.abs(out.y) > EPSILON;
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

// curve-node-shape — node-editor operations that reshape a canonical curve
// path without changing what it connects (ADR-376): smooth and corner nodes,
// handle drags that keep a smooth node smooth, and dragging a segment into a
// new shape. Canonical paths store no node type, so "smooth" is read from the
// geometry: both handles present and pointing in opposite directions.
//
// Pure core — no I/O, no globals, deterministic.

import {
  cornerCurveNode,
  curveControlPoint,
  curveNodeCount,
  curveNodePoint,
  moveCurveControl,
  smoothCurveNode,
  type CubicPathSegment,
  type CurveSubpath,
  type PathSegment,
  type Vec2,
} from '../scene';
import { incomingSegmentIndex, outgoingSegmentIndex } from '../scene/curve-edit';
import {
  explicitCurveSubpath,
  lineAsCubic,
  pointOnSegment,
  segmentAsCubics,
  segmentStartPoint,
} from './curve-segment-geometry';

// Handles within about 0.6° of a straight line through the node read as smooth.
const SMOOTH_SINE_TOLERANCE = 0.01;
// Grabbing a segment right beside a node would need unbounded handle travel;
// the reshape treats such a grab as if it were this far in.
const MIN_BEND_PARAMETER = 0.08;
const EPSILON = 1e-9;

export type HandleSide = 'incoming' | 'outgoing';

export function isSmoothCurveNode(path: CurveSubpath, nodeIndex: number): boolean {
  const anchor = curveNodePoint(path, nodeIndex);
  const incoming = curveControlPoint(path, nodeIndex, 'incoming');
  const outgoing = curveControlPoint(path, nodeIndex, 'outgoing');
  if (anchor === null || incoming === null || outgoing === null) return false;
  const a = subtract(incoming, anchor);
  const b = subtract(outgoing, anchor);
  const lengths = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (lengths <= EPSILON) return false;
  const dot = (a.x * b.x + a.y * b.y) / lengths;
  const cross = (a.x * b.y - a.y * b.x) / lengths;
  return dot < 0 && Math.abs(cross) <= SMOOTH_SINE_TOLERANCE;
}

/** Make the node smooth. Straight or arc neighbours become cubics first, so
 *  any interior node can be smoothed (LightBurn's S). Returns the new path and
 *  the node's index in it; an arc neighbour can add nodes before it. */
export function smoothCurveNodeOfAnyKind(
  path: CurveSubpath,
  nodeIndex: number,
): { readonly path: CurveSubpath; readonly nodeIndex: number } | null {
  const prepared = withCubicNeighbours(explicitCurveSubpath(path), nodeIndex);
  if (prepared === null) return null;
  const smoothed = smoothCurveNode(prepared.path, prepared.nodeIndex);
  return smoothed === null ? null : { path: smoothed, nodeIndex: prepared.nodeIndex };
}

/** S on a node: a smooth node turns into a corner, anything else smooths. */
export function toggleCurveNodeSmooth(path: CurveSubpath, nodeIndex: number): CurveSubpath | null {
  if (isSmoothCurveNode(path, nodeIndex)) return cornerCurveNode(path, nodeIndex);
  return smoothCurveNodeOfAnyKind(path, nodeIndex)?.path ?? null;
}

/** C on a node: only a smooth node changes; a corner already is one. */
export function cornerCurveNodeIfSmooth(
  path: CurveSubpath,
  nodeIndex: number,
): CurveSubpath | null {
  return isSmoothCurveNode(path, nodeIndex) ? cornerCurveNode(path, nodeIndex) : null;
}

/** Move one handle. On a smooth node the other handle turns to stay in line,
 *  keeping its own length, or matching the moved one when `mirrorLength`. */
export function moveCurveHandle(
  path: CurveSubpath,
  nodeIndex: number,
  side: HandleSide,
  to: Vec2,
  options: { readonly keepSmooth: boolean; readonly mirrorLength: boolean },
): CurveSubpath | null {
  const smooth = options.keepSmooth && isSmoothCurveNode(path, nodeIndex);
  const moved = moveCurveControl(path, nodeIndex, side, to);
  if (moved === null || !smooth) return moved;
  return alignOppositeHandle(moved, nodeIndex, side, options.mirrorLength) ?? moved;
}

/** Reshape a segment so its point at `t` lands on `target` with both end nodes
 *  fixed. A straight segment becomes a cubic first (drag a line into a curve);
 *  a curve moves its handles, weighted toward the nearer end as Inkscape's
 *  curve drag does. Smooth end nodes keep their other handle in line. */
export function bendCurveSegment(
  path: CurveSubpath,
  segmentIndex: number,
  t: number,
  target: Vec2,
): CurveSubpath | null {
  const explicit = explicitCurveSubpath(path);
  const segment = explicit.segments[segmentIndex];
  const from = segmentStartPoint(explicit, segmentIndex);
  if (segment === undefined || from === null || segment.kind === 'elliptical-arc') return null;
  const cubic = segment.kind === 'cubic' ? segment : lineAsCubic(from, segment.to);
  const grab = Math.min(1 - MIN_BEND_PARAMETER, Math.max(MIN_BEND_PARAMETER, t));
  const delta = subtract(target, pointOnSegment(from, cubic, grab));
  const weight = bendWeight(grab);
  const bent: CubicPathSegment = {
    ...cubic,
    control1: addScaled(cubic.control1, delta, (1 - weight) / (3 * grab * (1 - grab) ** 2)),
    control2: addScaled(cubic.control2, delta, weight / (3 * grab * grab * (1 - grab))),
  };
  let next = replaceSegments(explicit, segmentIndex, [bent]);
  const endNode = (segmentIndex + 1) % curveNodeCount(explicit);
  if (isSmoothCurveNode(explicit, segmentIndex)) {
    next = alignOppositeHandle(next, segmentIndex, 'outgoing', false) ?? next;
  }
  if (isSmoothCurveNode(explicit, endNode)) {
    next = alignOppositeHandle(next, endNode, 'incoming', false) ?? next;
  }
  return next;
}

/** Replace an arc segment with its cubic pieces so it can be bent. Returns the
 *  new path with the piece and piece parameter that hold the old `t`. */
export function cubicSegmentForBend(
  path: CurveSubpath,
  segmentIndex: number,
  t: number,
): { readonly path: CurveSubpath; readonly segmentIndex: number; readonly t: number } | null {
  const explicit = explicitCurveSubpath(path);
  const segment = explicit.segments[segmentIndex];
  const from = segmentStartPoint(explicit, segmentIndex);
  if (segment === undefined || from === null) return null;
  if (segment.kind !== 'elliptical-arc') return { path: explicit, segmentIndex, t };
  const pieces = segmentAsCubics(from, segment);
  const scaled = Math.min(pieces.length - 1e-9, Math.max(0, t * pieces.length));
  const piece = Math.floor(scaled);
  return {
    path: replaceSegments(explicit, segmentIndex, pieces),
    segmentIndex: segmentIndex + piece,
    t: scaled - piece,
  };
}

export function replaceSegments(
  path: CurveSubpath,
  segmentIndex: number,
  replacement: ReadonlyArray<PathSegment>,
): CurveSubpath {
  return {
    ...path,
    segments: [
      ...path.segments.slice(0, segmentIndex),
      ...replacement,
      ...path.segments.slice(segmentIndex + 1),
    ],
  };
}

// Inkscape's weighting: grabs in the first sixth move only the near handle,
// the last sixth only the far one, and the middle blends smoothly.
function bendWeight(t: number): number {
  if (t <= 1 / 6) return 0;
  if (t <= 0.5) return ((6 * t - 1) / 2) ** 3 / 2;
  if (t <= 5 / 6) return (1 - ((6 * (1 - t) - 1) / 2) ** 3) / 2 + 0.5;
  return 1;
}

function withCubicNeighbours(
  path: CurveSubpath,
  nodeIndex: number,
): { readonly path: CurveSubpath; readonly nodeIndex: number } | null {
  const incoming = incomingSegmentIndex(path, nodeIndex);
  const outgoing = outgoingSegmentIndex(path, nodeIndex);
  if (incoming === null || outgoing === null || incoming === outgoing) return null;
  let current = path;
  let node = nodeIndex;
  // The later segment first, so converting it never shifts the earlier one.
  for (const index of [Math.max(incoming, outgoing), Math.min(incoming, outgoing)]) {
    const segment = current.segments[index];
    const from = segmentStartPoint(current, index);
    if (segment === undefined || from === null) return null;
    if (segment.kind === 'cubic') continue;
    const cubics = segmentAsCubics(from, segment);
    current = replaceSegments(current, index, cubics);
    if (index < node) node += cubics.length - 1;
  }
  return { path: current, nodeIndex: node };
}

function alignOppositeHandle(
  path: CurveSubpath,
  nodeIndex: number,
  fixedSide: HandleSide,
  mirrorLength: boolean,
): CurveSubpath | null {
  const anchor = curveNodePoint(path, nodeIndex);
  const fixed = curveControlPoint(path, nodeIndex, fixedSide);
  const otherSide: HandleSide = fixedSide === 'incoming' ? 'outgoing' : 'incoming';
  const other = curveControlPoint(path, nodeIndex, otherSide);
  if (anchor === null || fixed === null || other === null) return null;
  const away = subtract(anchor, fixed);
  const awayLength = Math.hypot(away.x, away.y);
  if (awayLength <= EPSILON) return null;
  const length = mirrorLength ? awayLength : Math.hypot(other.x - anchor.x, other.y - anchor.y);
  return moveCurveControl(path, nodeIndex, otherSide, addScaled(anchor, away, length / awayLength));
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function addScaled(point: Vec2, vector: Vec2, scale: number): Vec2 {
  return { x: point.x + vector.x * scale, y: point.y + vector.y * scale };
}

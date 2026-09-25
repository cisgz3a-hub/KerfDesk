// curve-extend — LightBurn's Extend (E) for canonical curve paths (ADR-376):
// "Extend line to nearest intersecting path"
// (https://docs.lightburnsoftware.com/2.1/Reference/EditNodes/). An open end
// runs on the way it leaves the path until it first meets a cutter. A straight
// end segment just gets longer; a curved one keeps its shape and gains a
// straight run along its end tangent, so the path stays smooth there.
//
// The crossing is found in the caller's shared space (scene millimetres for
// artwork). The placement is affine, so the same fraction of the ray lands on
// the matching point back in path space.
//
// Pure core — no I/O, no globals, deterministic.

import type { CurveSubpath, PathSegment, Vec2 } from '../scene';
import { pointOnSegment, segmentStartPoint } from './curve-segment-geometry';
import type { TrimCutter } from './curve-trim';

export type CurveEnd = 'start' | 'end';

/** Where an extension starts and the way it runs, in shared space. */
export type ExtendRay = { readonly origin: Vec2; readonly direction: Vec2 };

export type CurveExtendResult =
  | { readonly kind: 'extended'; readonly path: CurveSubpath }
  | { readonly kind: 'no-crossing' };

// A hit closer than this (shared units) is the end itself, or a line the end
// already touches, so pressing Extend again runs on to the next one.
const MIN_REACH = 1e-6;
// Step used to read an arc's direction at its end.
const ARC_TANGENT_STEP = 1e-6;
// How far off the ray's line (shared units) a parallel edge still counts as on it.
const INLINE_TOLERANCE = 1e-9;

/** The open end a segment leads to: the first or last segment of an open path,
 *  and for a lone segment the end nearer parameter `t`. Null when the path is
 *  closed or the segment is interior. */
export function openEndOfSegment(
  path: CurveSubpath,
  segmentIndex: number,
  t: number,
): CurveEnd | null {
  const count = path.segments.length;
  if (path.closed || count === 0) return null;
  if (count === 1) return t < 0.5 ? 'start' : 'end';
  if (segmentIndex === 0) return 'start';
  return segmentIndex === count - 1 ? 'end' : null;
}

/** The open end a node is, or null for an interior node or a closed path. */
export function openEndOfNode(path: CurveSubpath, nodeIndex: number): CurveEnd | null {
  if (path.closed || path.segments.length === 0) return null;
  if (nodeIndex === 0) return 'start';
  return nodeIndex === path.segments.length ? 'end' : null;
}

/** The ray an end would be extended along, or null for a degenerate end. */
export function extendRay(
  path: CurveSubpath,
  end: CurveEnd,
  toShared: (point: Vec2) => Vec2,
): ExtendRay | null {
  const local = localEndRay(path, end);
  if (local === null) return null;
  const origin = toShared(local.point);
  const ahead = toShared({
    x: local.point.x + local.direction.x,
    y: local.point.y + local.direction.y,
  });
  const direction = { x: ahead.x - origin.x, y: ahead.y - origin.y };
  return Math.hypot(direction.x, direction.y) > 0 ? { origin, direction } : null;
}

export function extendCurveEnd(args: {
  readonly path: CurveSubpath;
  readonly end: CurveEnd;
  readonly toShared: (point: Vec2) => Vec2;
  readonly cutters: ReadonlyArray<TrimCutter>;
}): CurveExtendResult {
  const local = localEndRay(args.path, args.end);
  const ray = extendRay(args.path, args.end, args.toShared);
  const reach = ray === null ? null : nearestHit(ray, args.cutters);
  if (local === null || reach === null) return { kind: 'no-crossing' };
  const point = {
    x: local.point.x + local.direction.x * reach,
    y: local.point.y + local.direction.y * reach,
  };
  return { kind: 'extended', path: extendedPath(args.path, args.end, point, local.straight) };
}

type LocalRay = { readonly point: Vec2; readonly direction: Vec2; readonly straight: boolean };

function localEndRay(path: CurveSubpath, end: CurveEnd): LocalRay | null {
  const index = end === 'end' ? path.segments.length - 1 : 0;
  const segment = path.segments[index];
  const from = segmentStartPoint(path, index);
  if (path.closed || segment === undefined || from === null) return null;
  const direction = end === 'end' ? outAtEnd(from, segment) : outAtStart(from, segment);
  if (direction === null) return null;
  const point = end === 'end' ? segment.to : from;
  return { point, direction, straight: segment.kind === 'line' };
}

// The way the path leaves its last node, from the first control point that
// differs from the node.
function outAtEnd(from: Vec2, segment: PathSegment): Vec2 | null {
  if (segment.kind === 'elliptical-arc') {
    return away(pointOnSegment(from, segment, 1 - ARC_TANGENT_STEP), segment.to);
  }
  const controls = segment.kind === 'cubic' ? [segment.control2, segment.control1, from] : [from];
  return firstAway(controls, segment.to);
}

// The way the path leaves its first node backwards.
function outAtStart(from: Vec2, segment: PathSegment): Vec2 | null {
  if (segment.kind === 'elliptical-arc') {
    return away(pointOnSegment(from, segment, ARC_TANGENT_STEP), from);
  }
  const controls =
    segment.kind === 'cubic' ? [segment.control1, segment.control2, segment.to] : [segment.to];
  return firstAway(controls, from);
}

function firstAway(candidates: ReadonlyArray<Vec2>, node: Vec2): Vec2 | null {
  for (const candidate of candidates) {
    const direction = away(candidate, node);
    if (direction !== null) return direction;
  }
  return null;
}

function away(from: Vec2, to: Vec2): Vec2 | null {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : null;
}

/** The nearest cutter crossing ahead, as a multiple of the ray's direction. */
function nearestHit(ray: ExtendRay, cutters: ReadonlyArray<TrimCutter>): number | null {
  const length = Math.hypot(ray.direction.x, ray.direction.y);
  const unit = { x: ray.direction.x / length, y: ray.direction.y / length };
  let nearest: number | null = null;
  for (const cutter of cutters) {
    for (let index = 1; index < cutter.length; index += 1) {
      const hit = rayHit(ray.origin, unit, cutter[index - 1] as Vec2, cutter[index] as Vec2);
      if (hit !== null && (nearest === null || hit < nearest)) nearest = hit;
    }
  }
  return nearest === null ? null : nearest / length;
}

// Distance along the unit ray to where it meets edge ab, or null.
function rayHit(origin: Vec2, unit: Vec2, a: Vec2, b: Vec2): number | null {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const length = Math.hypot(sx, sy);
  if (length === 0) return null;
  const denominator = unit.x * sy - unit.y * sx;
  const qx = a.x - origin.x;
  const qy = a.y - origin.y;
  if (Math.abs(denominator) <= length * 1e-12) return inlineHit(origin, unit, a, b);
  const distance = (qx * sy - qy * sx) / denominator;
  const along = (qx * unit.y - qy * unit.x) / denominator;
  const slack = 1e-12;
  if (distance < MIN_REACH || along < -slack || along > 1 + slack) return null;
  return distance;
}

// An edge parallel to the ray is met only when it lies on the ray's line
// ahead of the end, as when closing the gap to a line that carries straight
// on; one the end already sits on is not in the way.
function inlineHit(origin: Vec2, unit: Vec2, a: Vec2, b: Vec2): number | null {
  const offset = (a.x - origin.x) * unit.y - (a.y - origin.y) * unit.x;
  if (Math.abs(offset) > INLINE_TOLERANCE) return null;
  const toA = (a.x - origin.x) * unit.x + (a.y - origin.y) * unit.y;
  const toB = (b.x - origin.x) * unit.x + (b.y - origin.y) * unit.y;
  const nearest = Math.min(toA, toB);
  return nearest >= MIN_REACH ? nearest : null;
}

function extendedPath(
  path: CurveSubpath,
  end: CurveEnd,
  point: Vec2,
  straight: boolean,
): CurveSubpath {
  if (end === 'end') {
    const last = path.segments.length - 1;
    const segments: ReadonlyArray<PathSegment> = straight
      ? [...path.segments.slice(0, last), { kind: 'line', to: point }]
      : [...path.segments, { kind: 'line', to: point }];
    return { ...path, segments };
  }
  if (straight) return { ...path, start: point };
  return { ...path, start: point, segments: [{ kind: 'line', to: path.start }, ...path.segments] };
}

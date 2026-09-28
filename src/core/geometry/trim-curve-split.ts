// Exact pieces of a canonical contour for Trim Shapes (LightBurn gap LBG-T04).
//
// A contour's segments are numbered 0..n-1; a closed contour whose last point
// is not its start gets its implied closing line as segment n-1. A position on
// the contour is one number p = segment + t, with t in [0, 1]. Lines split by
// interpolation, cubic Béziers by de Casteljau and elliptical arcs by angle, so
// every piece traces exactly the curve it was cut from.

import { endpointArc, pointOnArc } from '../scene/curve-path';
import type { CubicPathSegment, CurveSubpath, PathSegment, Vec2 } from '../scene';

export type ContourSegments = {
  readonly start: Vec2;
  readonly segments: ReadonlyArray<PathSegment>;
  readonly closed: boolean;
};

const SAME_POINT_MM = 1e-9;

/** The segment list of a contour, with a closed contour's closing line made explicit. */
export function contourSegments(curve: CurveSubpath, closed: boolean): ContourSegments {
  const end = curve.segments.at(-1)?.to ?? curve.start;
  const closing: PathSegment[] =
    closed && !samePoint(end, curve.start) ? [{ kind: 'line', to: curve.start }] : [];
  return { start: curve.start, segments: [...curve.segments, ...closing], closed };
}

export function segmentStart(contour: ContourSegments, index: number): Vec2 {
  return index <= 0 ? contour.start : (contour.segments[index - 1]?.to ?? contour.start);
}

/** The segment index and parameter of a contour position, clamped to the contour. */
export function contourParam(
  contour: ContourSegments,
  p: number,
): { readonly index: number; readonly t: number } {
  const last = contour.segments.length - 1;
  if (last < 0 || !(p > 0)) return { index: 0, t: 0 };
  if (p >= last + 1) return { index: last, t: 1 };
  const index = Math.floor(p);
  return { index, t: p - index };
}

export function contourPoint(contour: ContourSegments, p: number): Vec2 {
  const { index, t } = contourParam(contour, p);
  const segment = contour.segments[index];
  if (segment === undefined) return contour.start;
  return segmentPoint(segmentStart(contour, index), segment, t);
}

export function segmentPoint(from: Vec2, segment: PathSegment, t: number): Vec2 {
  if (t <= 0) return from;
  if (t >= 1) return segment.to;
  if (segment.kind === 'line') return lerp(from, segment.to, t);
  if (segment.kind === 'cubic') return cubicPoint(from, segment, t);
  const arc = endpointArc(from, segment);
  return arc === null ? lerp(from, segment.to, t) : pointOnArc(arc, arc.theta1 + arc.delta * t);
}

/** The open piece of the contour running forward from `from` to `to` (0 <= from < to <= n). */
export function sliceContour(contour: ContourSegments, from: number, to: number): CurveSubpath {
  const start = contourPoint(contour, from);
  if (!(to > from)) return { start, segments: [], closed: false };
  const a = contourParam(contour, from);
  const b = contourParam(contour, to);
  const segments: PathSegment[] = [];
  for (let index = a.index; index <= b.index; index += 1) {
    const segment = contour.segments[index];
    if (segment === undefined) continue;
    const t0 = index === a.index ? a.t : 0;
    const t1 = index === b.index ? b.t : 1;
    if (t1 - t0 <= 0) continue;
    segments.push(subSegment(segmentStart(contour, index), segment, t0, t1));
  }
  return { start, segments, closed: false };
}

/** The open piece running forward from `from` to `to` on a closed contour, passing its start when `to <= from`. */
export function sliceClosedContour(
  contour: ContourSegments,
  from: number,
  to: number,
): CurveSubpath {
  if (to > from) return sliceContour(contour, from, to);
  const end = contour.segments.length;
  const head = sliceContour(contour, from, end);
  const tail = sliceContour(contour, 0, to);
  return { start: head.start, segments: [...head.segments, ...tail.segments], closed: false };
}

/** The part of one segment between t0 and t1 (0 <= t0 < t1 <= 1), keeping its kind. */
export function subSegment(from: Vec2, segment: PathSegment, t0: number, t1: number): PathSegment {
  const to = segmentPoint(from, segment, t1);
  if (segment.kind === 'line') return { kind: 'line', to };
  if (segment.kind === 'cubic') return subCubic(from, segment, t0, t1);
  const arc = endpointArc(from, segment);
  if (arc === null) return { kind: 'line', to };
  const sweepRad = arc.delta * (t1 - t0);
  return {
    kind: 'elliptical-arc',
    radiusX: arc.radiusX,
    radiusY: arc.radiusY,
    rotationDeg: segment.rotationDeg,
    largeArc: Math.abs(sweepRad) > Math.PI,
    sweep: segment.sweep,
    to,
  };
}

function subCubic(from: Vec2, segment: CubicPathSegment, t0: number, t1: number): PathSegment {
  const controls: CubicControls = [from, segment.control1, segment.control2, segment.to];
  const left = t1 >= 1 ? controls : splitCubic(controls, t1)[0];
  const piece = t0 <= 0 ? left : splitCubic(left, t0 / t1)[1];
  return {
    kind: 'cubic',
    control1: piece[1],
    control2: piece[2],
    to: t1 >= 1 ? segment.to : piece[3],
  };
}

type CubicControls = readonly [Vec2, Vec2, Vec2, Vec2];

/** de Casteljau: the two exact halves of a cubic at t. */
export function splitCubic(
  controls: CubicControls,
  t: number,
): readonly [CubicControls, CubicControls] {
  const [p0, p1, p2, p3] = controls;
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const f = lerp(d, e, t);
  return [
    [p0, a, d, f],
    [f, e, c, p3],
  ];
}

function cubicPoint(from: Vec2, segment: CubicPathSegment, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * segment.control1.x + c * segment.control2.x + d * segment.to.x,
    y: a * from.y + b * segment.control1.y + c * segment.control2.y + d * segment.to.y,
  };
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= SAME_POINT_MM && Math.abs(a.y - b.y) <= SAME_POINT_MM;
}

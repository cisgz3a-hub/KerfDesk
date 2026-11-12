// Close Selected Paths With Tolerance (LightBurn Edit menu): close every open
// path whose ends lie within a world-millimetre gap, for any operation, not
// only Fill. Two modes, as in LightBurn:
//   bridge     adds a closing line across the gap; every existing point stays.
//   move-ends  moves both ends to their midpoint, so no new segment appears.
//              A cubic end keeps its tangent: its control point moves with it.
//              An elliptical arc at an end is first replaced by the cubics that
//              trace it, because an arc re-solved between moved ends changes
//              shape: a single-arc path collapsed to a point, and an end arc
//              near a half circle bulged many times the gap (tools audit T1,
//              T10-P2-1 and T10R-P2-1).
// Curves and their compatibility polylines change together, and a path whose
// two lists do not pair up one to one is left alone.

import {
  applyTransform,
  type ColoredPath,
  type CubicPathSegment,
  type CurveSubpath,
  type EllipticalArcPathSegment,
  type PathSegment,
  type Polyline,
  type Transform,
  type Vec2,
} from '../scene';
// Deep import: core/scene's barrel is ratcheted and may only shrink.
import { endpointArc, pointOnArc, type CenterArc } from '../scene/curve-path';
import { closeOpenPaths, isCloseablePolyline } from './path-direction-edits';
import { midpoint, addPoints } from './point-math';

export type CloseToleranceMode = 'bridge' | 'move-ends';

export type CloseWithinToleranceResult = {
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly closed: number;
  /** Open paths whose gap is wider than the tolerance. */
  readonly remaining: number;
};

export function closePathsWithinTolerance(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
  toleranceMm: number,
  mode: CloseToleranceMode,
): CloseWithinToleranceResult {
  if (!(toleranceMm >= 0)) return { paths, closed: 0, remaining: 0 };
  let remaining = 0;
  const within = (polyline: Polyline, index: number, path: ColoredPath): boolean => {
    if (!isCloseablePolyline(polyline) || !pairs(path)) return false;
    const ends = pathEnds(path, index);
    if (ends === null) return false;
    const ok = worldGap(ends, transform) <= toleranceMm;
    if (!ok) remaining += 1;
    return ok;
  };
  if (mode === 'bridge') {
    const result = closeOpenPaths(paths, transform, within);
    return { paths: result.paths, closed: result.closed, remaining };
  }
  let closed = 0;
  const next = paths.map((path) => {
    const targets = new Set(
      path.polylines.flatMap((polyline, index) => (within(polyline, index, path) ? [index] : [])),
    );
    if (targets.size === 0) return path;
    closed += targets.size;
    return {
      ...path,
      polylines: path.polylines.map((polyline, index) =>
        targets.has(index) ? meetPolyline(polyline) : polyline,
      ),
      ...(path.curves === undefined
        ? {}
        : {
            curves: path.curves.map((curve, index) =>
              targets.has(index) ? meetCurve(curve) : curve,
            ),
          }),
    };
  });
  return { paths: closed === 0 ? paths : next, closed, remaining };
}

function pairs(path: ColoredPath): boolean {
  return path.curves === undefined || path.curves.length === path.polylines.length;
}

function pathEnds(path: ColoredPath, index: number): readonly [Vec2, Vec2] | null {
  const curve = path.curves?.[index];
  if (curve !== undefined) return [curve.start, curve.segments.at(-1)?.to ?? curve.start];
  const polyline = path.polylines[index];
  const first = polyline?.points[0];
  const last = polyline?.points.at(-1);
  return first === undefined || last === undefined ? null : [first, last];
}

function worldGap([a, b]: readonly [Vec2, Vec2], transform: Transform): number {
  const p = applyTransform(a, transform);
  const q = applyTransform(b, transform);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function meetPolyline(polyline: Polyline): Polyline {
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  if (first === undefined || last === undefined) return polyline;
  const meet = midpoint(first, last);
  return { ...polyline, closed: true, points: [meet, ...polyline.points.slice(1, -1), meet] };
}

function meetCurve(original: CurveSubpath): CurveSubpath {
  const curve = withEndArcsAsCubics(original);
  const last = curve.segments.at(-1);
  if (last === undefined) return curve;
  const meet = midpoint(curve.start, last.to);
  const startShift = { x: meet.x - curve.start.x, y: meet.y - curve.start.y };
  const endShift = { x: meet.x - last.to.x, y: meet.y - last.to.y };
  const segments = curve.segments.map((segment, index) => {
    let next: PathSegment = segment;
    if (index === 0 && next.kind === 'cubic')
      next = { ...next, control1: addPoints(next.control1, startShift) };
    if (index === curve.segments.length - 1) {
      next =
        next.kind === 'cubic'
          ? { ...next, control2: addPoints(next.control2, endShift), to: meet }
          : { ...next, to: meet };
    }
    return next;
  });
  return { start: meet, segments, closed: true };
}

/** The subpath with an elliptical arc at either end replaced by its cubics. */
function withEndArcsAsCubics(curve: CurveSubpath): CurveSubpath {
  const lastIndex = curve.segments.length - 1;
  if (lastIndex < 0) return curve;
  let from = curve.start;
  const segments = curve.segments.flatMap((segment, index) => {
    const start = from;
    from = segment.to;
    return segment.kind === 'elliptical-arc' && (index === 0 || index === lastIndex)
      ? arcAsCubics(start, segment)
      : [segment];
  });
  return segments.length === curve.segments.length ? curve : { ...curve, segments };
}

/** Cubic pieces of at most a quarter turn tracing the arc; a degenerate arc,
 * which is drawn as its chord, becomes that line. */
function arcAsCubics(from: Vec2, segment: EllipticalArcPathSegment): PathSegment[] {
  const arc = endpointArc(from, segment);
  if (arc === null) return [{ kind: 'line', to: segment.to }];
  const pieces = Math.max(1, Math.ceil(Math.abs(arc.delta) / (Math.PI / 2) - 1e-9));
  const step = arc.delta / pieces;
  const handle = (4 / 3) * Math.tan(step / 4);
  return Array.from({ length: pieces }, (_, index): CubicPathSegment => {
    const a = arc.theta1 + step * index;
    const b = a + step;
    const p0 = pointOnArc(arc, a);
    const p3 = index === pieces - 1 ? segment.to : pointOnArc(arc, b);
    const d0 = arcTangent(arc, a);
    const d3 = arcTangent(arc, b);
    return {
      kind: 'cubic',
      control1: { x: p0.x + handle * d0.x, y: p0.y + handle * d0.y },
      control2: { x: p3.x - handle * d3.x, y: p3.y - handle * d3.y },
      to: p3,
    };
  });
}

/** d/dθ of the arc's point at θ. */
function arcTangent(arc: CenterArc, theta: number): Vec2 {
  const cosPhi = Math.cos(arc.rotationRad);
  const sinPhi = Math.sin(arc.rotationRad);
  const dx = -arc.radiusX * Math.sin(theta);
  const dy = arc.radiusY * Math.cos(theta);
  return { x: dx * cosPhi - dy * sinPhi, y: dx * sinPhi + dy * cosPhi };
}

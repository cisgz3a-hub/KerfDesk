// Close Selected Paths With Tolerance (LightBurn Edit menu): close every open
// path whose ends lie within a world-millimetre gap, for any operation, not
// only Fill. Two modes, as in LightBurn:
//   bridge     adds a closing line across the gap; every existing point stays.
//   move-ends  moves both ends to their midpoint, so no new segment appears.
//              A cubic end keeps its tangent: its control point moves with it.
// Curves and their compatibility polylines change together, and a path whose
// two lists do not pair up one to one is left alone.

import {
  applyTransform,
  type ColoredPath,
  type CurveSubpath,
  type PathSegment,
  type Polyline,
  type Transform,
  type Vec2,
} from '../scene';
import { closeOpenPaths, isCloseablePolyline } from './path-direction-edits';

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

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function meetPolyline(polyline: Polyline): Polyline {
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  if (first === undefined || last === undefined) return polyline;
  const meet = midpoint(first, last);
  return { ...polyline, closed: true, points: [meet, ...polyline.points.slice(1, -1), meet] };
}

function meetCurve(curve: CurveSubpath): CurveSubpath {
  const last = curve.segments.at(-1);
  if (last === undefined) return curve;
  const meet = midpoint(curve.start, last.to);
  const startShift = { x: meet.x - curve.start.x, y: meet.y - curve.start.y };
  const endShift = { x: meet.x - last.to.x, y: meet.y - last.to.y };
  const segments = curve.segments.map((segment, index) => {
    let next: PathSegment = segment;
    if (index === 0 && next.kind === 'cubic')
      next = { ...next, control1: shift(next.control1, startShift) };
    if (index === curve.segments.length - 1) {
      next =
        next.kind === 'cubic'
          ? { ...next, control2: shift(next.control2, endShift), to: meet }
          : { ...next, to: meet };
    }
    return next;
  });
  return { start: meet, segments, closed: true };
}

function shift(point: Vec2, by: Vec2): Vec2 {
  return { x: point.x + by.x, y: point.y + by.y };
}

// Close Path and Reverse Direction (LightBurn gap LBG-F08, ADR-480) on one
// object's paths. Both edit the exact curves when a path has them, and the
// compatibility polyline at the same index, so a saved and reopened project
// cuts what the user saw. A path whose curves and polylines do not pair up
// one to one is left alone rather than guessed at.

import {
  applyTransform,
  curveEndpointJoin,
  isClosedEnough,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Transform,
  type Vec2,
} from '../scene';
import { CLOSURE_EPS_MM } from '../scene/polyline-closure';

export type ClosePathsResult = {
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly closed: number;
  /** The widest gap a closing line had to bridge, in world millimetres. */
  readonly longestGapMm: number;
};

export type ReversePathsResult = {
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly reversed: number;
  readonly openReversed: number;
};

/**
 * An open path with a real shape to close: three or more points. One whose ends
 * already meet counts too: fill and preflight treat it as closed, but kerf,
 * tabs, overcut, containment and weld go by the closed flag, so it needs it.
 */
export function isCloseablePolyline(polyline: Polyline): boolean {
  return polyline.points.length >= 3 && !polyline.closed;
}

export function closeOpenPaths(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
): ClosePathsResult {
  let closed = 0;
  let longestGapMm = 0;
  const next = paths.map((path) => {
    if (!curvesPairWithPolylines(path)) return path;
    const indexes = path.polylines.flatMap((polyline, index) =>
      isCloseablePolyline(polyline) ? [index] : [],
    );
    if (indexes.length === 0) return path;
    for (const index of indexes) {
      longestGapMm = Math.max(longestGapMm, worldGapMm(path.polylines[index], transform));
    }
    closed += indexes.length;
    const targets = new Set(indexes);
    return {
      ...path,
      polylines: path.polylines.map((polyline, index) =>
        targets.has(index) ? closePolyline(polyline) : polyline,
      ),
      ...(path.curves === undefined
        ? {}
        : {
            curves: path.curves.map((curve, index) =>
              targets.has(index) ? closeCurve(curve) : curve,
            ),
          }),
    };
  });
  return { paths: closed === 0 ? paths : next, closed, longestGapMm };
}

export function reversePaths(paths: ReadonlyArray<ColoredPath>): ReversePathsResult {
  let reversed = 0;
  let openReversed = 0;
  const next = paths.map((path) => {
    if (!curvesPairWithPolylines(path)) return path;
    const polylines = path.polylines.map((polyline) => {
      if (polyline.points.length < 2) return polyline;
      reversed += 1;
      if (!polyline.closed) openReversed += 1;
      return reversePolyline(polyline);
    });
    return {
      ...path,
      polylines,
      ...(path.curves === undefined ? {} : { curves: path.curves.map(reverseCurveKeepingStart) }),
    };
  });
  return { paths: reversed === 0 ? paths : next, reversed, openReversed };
}

/**
 * A closed path keeps its start point; an open one swaps its ends. A closed
 * path that already repeats its start at the end reverses whole, which keeps
 * both the start and the repeated seam point.
 */
export function reversePolyline(polyline: Polyline): Polyline {
  const [first, ...rest] = polyline.points;
  const last = polyline.points.at(-1);
  if (first === undefined || last === undefined) return polyline;
  const keepFirst = polyline.closed && !samePoint(first, last);
  return keepFirst
    ? { ...polyline, points: [first, ...rest.reverse()] }
    : { ...polyline, points: [...polyline.points].reverse() };
}

function reverseCurveKeepingStart(curve: CurveSubpath): CurveSubpath {
  if (curve.segments.length === 0) return curve;
  if (!curve.closed) return curveEndpointJoin.reverse(curve);
  const end = curve.segments.at(-1)?.to ?? curve.start;
  const explicit = samePoint(end, curve.start)
    ? curve
    : { ...curve, segments: [...curve.segments, { kind: 'line' as const, to: curve.start }] };
  return curveEndpointJoin.reverse(explicit);
}

// A closed polyline repeats its first point, as imported and offset paths do, so
// the canvas strokes the closing line and the curve's closing segment matches it.
// A path whose ends already meet is stored as Z would have closed it: its last
// point moves onto the first instead of a second closing point being added.
function closePolyline(polyline: Polyline): Polyline {
  const drawn = isClosedEnough(polyline) ? polyline.points.slice(0, -1) : polyline.points;
  return { closed: true, points: [...drawn, ...polyline.points.slice(0, 1)] };
}

function closeCurve(curve: CurveSubpath): CurveSubpath {
  const last = curve.segments.at(-1);
  const end = last?.to ?? curve.start;
  if (samePoint(end, curve.start)) return { ...curve, closed: true };
  const segments =
    last !== undefined && endsMeet(end, curve.start)
      ? [...curve.segments.slice(0, -1), { ...last, to: curve.start }]
      : [...curve.segments, { kind: 'line' as const, to: curve.start }];
  return { ...curve, segments, closed: true };
}

function curvesPairWithPolylines(path: ColoredPath): boolean {
  return path.curves === undefined || path.curves.length === path.polylines.length;
}

function worldGapMm(polyline: Polyline | undefined, transform: Transform): number {
  const first = polyline?.points[0];
  const last = polyline?.points.at(-1);
  if (first === undefined || last === undefined) return 0;
  const a = applyTransform(first, transform);
  const b = applyTransform(last, transform);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
}

// isClosedEnough's test, so a curve and its polyline agree on whether they meet.
function endsMeet(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < CLOSURE_EPS_MM && Math.abs(a.y - b.y) < CLOSURE_EPS_MM;
}

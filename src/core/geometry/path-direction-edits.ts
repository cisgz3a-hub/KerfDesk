// Close Path and Reverse Direction (LightBurn gap LBG-F08, ADR-480) on one
// object's paths. Both edit the exact curves when a path has them, and the
// compatibility polyline at the same index, so a saved and reopened project
// cuts what the user saw. A path whose curves and polylines do not pair up
// one to one is left alone rather than guessed at.

import {
  applyTransform,
  curveEndpointJoin,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Transform,
  type Vec2,
} from '../scene';

export type ClosePathsResult = {
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly closed: number;
  /** The widest gap a closing line had to bridge, in world millimetres. */
  readonly longestGapMm: number;
};

/** A caller may target canonical contours even when a legacy compatibility flag says closed. */
export type ClosePathPredicate = (
  polyline: Polyline,
  subpathIndex: number,
  path: ColoredPath,
) => boolean;

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
  shouldClose: ClosePathPredicate = isCloseablePolyline,
): ClosePathsResult {
  let closed = 0;
  let longestGapMm = 0;
  const next = paths.map((path) => {
    if (!curvesPairWithPolylines(path)) return path;
    const indexes = path.polylines.flatMap((polyline, index) =>
      shouldClose(polyline, index, path) ? [index] : [],
    );
    if (indexes.length === 0) return path;
    for (const index of indexes) {
      longestGapMm = Math.max(longestGapMm, worldGapMm(path, index, transform));
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
// Only exactly coincident endpoints already have a seam. Preserve every other
// endpoint: a tiny local gap may be substantial after the object's transform.
function closePolyline(polyline: Polyline): Polyline {
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  // An older Fill repair set only the closed flag. That does not make its
  // genuine last endpoint a repeated seam point.
  const repeatsStart = first !== undefined && last !== undefined && coincident(first, last);
  const points = repeatsStart
    ? polyline.points
    : [...polyline.points, ...polyline.points.slice(0, 1)];
  return { ...polyline, closed: true, points };
}

function closeCurve(curve: CurveSubpath): CurveSubpath {
  const last = curve.segments.at(-1);
  const end = last?.to ?? curve.start;
  if (coincident(end, curve.start)) return { ...curve, closed: true };
  const segments = [...curve.segments, { kind: 'line' as const, to: curve.start }];
  return { ...curve, segments, closed: true };
}

function curvesPairWithPolylines(path: ColoredPath): boolean {
  return path.curves === undefined || path.curves.length === path.polylines.length;
}

function worldGapMm(path: ColoredPath, index: number, transform: Transform): number {
  const curve = path.curves?.[index];
  const polyline = path.polylines[index];
  const first = curve?.start ?? polyline?.points[0];
  const last = curve === undefined ? polyline?.points.at(-1) : (curve.segments.at(-1)?.to ?? first);
  if (first === undefined || last === undefined) return 0;
  const a = applyTransform(first, transform);
  const b = applyTransform(last, transform);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
}

function coincident(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

// Subdivision before a text warp (oracle audit O7-P2-2). Bend and path text
// move every point of a glyph through a non-affine map, but they mapped only
// segment endpoints and cubic control points, so a straight stroke stayed a
// straight chord between its two mapped ends: the crossbar of a Size 50 "H"
// bent 180° sat 3.6 mm off the arc it was meant to follow. Splitting each
// segment into short pieces first keeps every piece close enough to affine
// that mapping its points maps the piece.
//
// Pure: no I/O, deterministic.

import type {
  ColoredPath,
  CubicPathSegment,
  CurveSubpath,
  PathSegment,
  Polyline,
  Vec2,
} from '../scene';
import { lerpPoint as lerp } from '../geometry/point-math';

/**
 * Where a warp stops being affine. No piece spans more than `maxStepX` mm in
 * x, and straight edges also break at each `breaksX` (ascending), where a
 * piecewise-linear guide turns, so they follow the guide exactly.
 */
export type WarpGrid = {
  readonly maxStepX: number;
  readonly breaksX?: ReadonlyArray<number>;
};

// A hard cap keeps a pathological input (a huge glyph and a tiny step) bounded.
const MAX_PIECES = 4096;

/** A text batch with every contour subdivided on `grid`; contour counts are kept. */
export function subdivideColoredPathForWarp(path: ColoredPath, grid: WarpGrid): ColoredPath {
  if (!usable(grid)) return path;
  return {
    ...path,
    polylines: path.polylines.map((polyline) => subdividePolylineForWarp(polyline, grid)),
    ...(path.curves === undefined
      ? {}
      : { curves: path.curves.map((curve) => subdivideCurveForWarp(curve, grid)) }),
  };
}

export function subdivideCurveForWarp(curve: CurveSubpath, grid: WarpGrid): CurveSubpath {
  if (!usable(grid)) return curve;
  const segments: PathSegment[] = [];
  let from = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'line') {
      for (const t of straightSplits(from.x, segment.to.x, grid)) {
        segments.push({ kind: 'line', to: lerp(from, segment.to, t) });
      }
      segments.push(segment);
    } else if (segment.kind === 'cubic') {
      segments.push(...splitCubic(from, segment, grid.maxStepX));
    } else {
      segments.push(segment);
    }
    from = segment.to;
  }
  return segments.length === curve.segments.length ? curve : { ...curve, segments };
}

export function subdividePolylineForWarp(polyline: Polyline, grid: WarpGrid): Polyline {
  if (!usable(grid) || polyline.points.length < 2) return polyline;
  const points: Vec2[] = [];
  polyline.points.forEach((point, index) => {
    const previous = polyline.points[index - 1];
    if (previous !== undefined) {
      for (const t of straightSplits(previous.x, point.x, grid)) {
        points.push(lerp(previous, point, t));
      }
    }
    points.push(point);
  });
  return points.length === polyline.points.length ? polyline : { ...polyline, points };
}

function usable(grid: WarpGrid): boolean {
  return grid.maxStepX > 0 && Number.isFinite(grid.maxStepX);
}

/** Parameters strictly inside (0, 1), ascending, where a straight edge from x0 to x1 splits. */
function straightSplits(x0: number, x1: number, grid: WarpGrid): number[] {
  const span = Math.abs(x1 - x0);
  if (span === 0) return [];
  const pieces = pieceCount(span, grid.maxStepX);
  const splits: number[] = [];
  for (let piece = 1; piece < pieces; piece += 1) splits.push(piece / pieces);
  const low = Math.min(x0, x1);
  const high = Math.max(x0, x1);
  const breaks = grid.breaksX ?? [];
  // A long guide has tens of thousands of breaks; visit only those inside the edge.
  for (let index = firstAbove(breaks, low); index < breaks.length; index += 1) {
    const x = breaks[index] as number;
    if (x >= high || splits.length >= MAX_PIECES) break;
    splits.push((x - x0) / (x1 - x0));
  }
  return splits.sort((a, b) => a - b);
}

/** Index of the first value strictly greater than `x` in an ascending list. */
function firstAbove(values: ReadonlyArray<number>, x: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((values[middle] ?? Number.POSITIVE_INFINITY) <= x) low = middle + 1;
    else high = middle;
  }
  return low;
}

function splitCubic(from: Vec2, segment: CubicPathSegment, maxStepX: number): PathSegment[] {
  const { control1, control2, to } = segment;
  const spanX =
    Math.max(from.x, control1.x, control2.x, to.x) - Math.min(from.x, control1.x, control2.x, to.x);
  const pieces = pieceCount(spanX, maxStepX);
  if (pieces <= 1) return [segment];
  const out: CubicPathSegment[] = [];
  let p0 = from,
    p1 = control1,
    p2 = control2;
  for (let piece = 0; piece < pieces - 1; piece += 1) {
    // De Casteljau: cut one piece's share off the front of what is left.
    const t = 1 / (pieces - piece);
    const a = lerp(p0, p1, t),
      b = lerp(p1, p2, t),
      c = lerp(p2, to, t);
    const d = lerp(a, b, t),
      e = lerp(b, c, t);
    const f = lerp(d, e, t);
    out.push({ kind: 'cubic', control1: a, control2: d, to: f });
    p0 = f;
    p1 = e;
    p2 = c;
  }
  out.push({ kind: 'cubic', control1: p1, control2: p2, to });
  return out;
}

function pieceCount(spanX: number, maxStepX: number): number {
  return Math.min(MAX_PIECES, Math.max(1, Math.ceil(spanX / maxStepX - 1e-9)));
}

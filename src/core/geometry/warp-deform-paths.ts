// Apply a Warp or Deform map (LBG-T06) to artwork paths. The maps are not
// linear, so exact curves cannot survive: each path is flattened, every point
// is mapped, and each straight piece is split until its mapped image stays
// within tolerance of the true bent line. A projective Warp keeps lines
// straight, so its pieces are never split. The result is plain polylines with
// the exact-curve data dropped; closed contours stay closed and end on the
// point they start from.

import { flattenColoredPathCurvesForTransform } from '../scene/curve-path';
import { withClosingPoint } from '../scene/polyline-closure';
import {
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type Polyline,
  type Transform,
  type Vec2,
} from '../scene/scene-object';
import { applyTransform } from '../scene/transform';
import type { PointMap } from './warp-deform-map';

/** How far, in millimetres, the result may stray from the truly warped artwork. */
export const WARP_DEFORM_TOLERANCE_MM = 0.05;
// Split budget for a bent straight piece; flattening gets what remains, less a margin.
const SPLIT_TOLERANCE_MM = 0.02;
const TOLERANCE_MARGIN_MM = 0.005;
const MIN_FLATTEN_TOLERANCE_MM = 0.001;
const MAX_SPLIT_DEPTH = 12;
const MIN_TEST_POINTS = 3;
const MAX_TEST_POINTS = 32;
const TEST_POINTS_PER_FEATURE = 3;

export type WarpedPaths = {
  readonly paths: ReadonlyArray<ColoredPath>;
  /** The object's transform, or identity when the paths are now in world space. */
  readonly transform: Transform;
  /** True when any path had an exact curve that is now fine straight lines. */
  readonly curvesFlattened: boolean;
};

/**
 * Warp one object's paths. The map works in world millimetres; the result is
 * in the object's own space under its unchanged transform, or in world space
 * under the identity transform when `space` is 'world' or the transform cannot
 * be undone (a zero scale).
 */
export function warpObjectPaths(
  paths: ReadonlyArray<ColoredPath>,
  transform: Transform,
  map: PointMap,
  stretch: number,
  space: 'local' | 'world' = 'local',
): WarpedPaths {
  const keepLocal = space === 'local' && invertibleTransform(transform);
  const toOutput = keepLocal
    ? (point: Vec2) => worldToLocal(point, transform)
    : (point: Vec2) => point;
  const toleranceMm = flattenToleranceMm(map, stretch);
  let curvesFlattened = false;
  const warped = paths.map((path): ColoredPath => {
    if (hasExactCurves(path)) curvesFlattened = true;
    const { curves: _curves, ...rest } = path;
    return {
      ...rest,
      polylines: sourcePolylines(path, transform, toleranceMm).map((polyline) =>
        warpLocalPolyline(polyline, transform, map, toOutput),
      ),
    };
  });
  return { paths: warped, transform: keepLocal ? transform : IDENTITY_TRANSFORM, curvesFlattened };
}

/**
 * Map world points through `map`, splitting each straight piece the map bends
 * until every test point on its image lies within `toleranceMm` of the chord.
 * A closed run gains its closing piece and ends on exactly its first point.
 */
export function warpWorldPoints(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  map: PointMap,
  toleranceMm = SPLIT_TOLERANCE_MM,
): ReadonlyArray<Vec2> {
  const source = withClosingPoint(points, closed);
  const first = source[0];
  if (first === undefined) return [];
  const out: Vec2[] = [map.apply(first)];
  for (let index = 1; index < source.length; index += 1) {
    const from = source[index - 1] as Vec2;
    const to = source[index] as Vec2;
    const mappedTo = map.apply(to);
    if (map.keepsLinesStraight) out.push(mappedTo);
    else
      splitPiece({ from, to, mappedFrom: out.at(-1) as Vec2, mappedTo }, map, toleranceMm, 0, out);
  }
  if (closed && out.length > 1) out[out.length - 1] = out[0] as Vec2;
  return out;
}

type Piece = {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly mappedFrom: Vec2;
  readonly mappedTo: Vec2;
};

function splitPiece(
  piece: Piece,
  map: PointMap,
  toleranceMm: number,
  depth: number,
  out: Vec2[],
): void {
  if (depth >= MAX_SPLIT_DEPTH || !pieceBends(piece, map, toleranceMm)) {
    out.push(piece.mappedTo);
    return;
  }
  const middle = {
    x: (piece.from.x + piece.to.x) / 2,
    y: (piece.from.y + piece.to.y) / 2,
  };
  const mappedMiddle = map.apply(middle);
  splitPiece({ ...piece, to: middle, mappedTo: mappedMiddle }, map, toleranceMm, depth + 1, out);
  splitPiece(
    { ...piece, from: middle, mappedFrom: mappedMiddle },
    map,
    toleranceMm,
    depth + 1,
    out,
  );
}

// A long piece gets more test points than a short one, so a bend narrower
// than the piece cannot hide between them.
function pieceBends(piece: Piece, map: PointMap, toleranceMm: number): boolean {
  const length = Math.hypot(piece.to.x - piece.from.x, piece.to.y - piece.from.y);
  if (length === 0) return false;
  const perFeature = Number.isFinite(map.featureSizeMm)
    ? Math.ceil((TEST_POINTS_PER_FEATURE * length) / map.featureSizeMm)
    : 0;
  const tests = Math.min(MAX_TEST_POINTS, Math.max(MIN_TEST_POINTS, perFeature));
  for (let index = 1; index <= tests; index += 1) {
    const t = index / (tests + 1);
    const mapped = map.apply({
      x: piece.from.x + (piece.to.x - piece.from.x) * t,
      y: piece.from.y + (piece.to.y - piece.from.y) * t,
    });
    if (distanceToSegment(mapped, piece.mappedFrom, piece.mappedTo) > toleranceMm) return true;
  }
  return false;
}

export function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

// Flattening error grows by the map's stretch; the split error does not.
function flattenToleranceMm(map: PointMap, stretch: number): number {
  const budget =
    WARP_DEFORM_TOLERANCE_MM -
    TOLERANCE_MARGIN_MM -
    (map.keepsLinesStraight ? 0 : SPLIT_TOLERANCE_MM);
  return Math.max(MIN_FLATTEN_TOLERANCE_MM, budget / Math.max(1, stretch));
}

// The path's exact curves flattened in its own space so the flattening error
// is `toleranceMm` in world millimetres, or its polylines when it has no curves
// or they are too many to flatten that finely.
function sourcePolylines(
  path: ColoredPath,
  transform: Transform,
  toleranceMm: number,
): ReadonlyArray<Polyline> {
  const flattened = flattenColoredPathCurvesForTransform(path, transform, { toleranceMm });
  return flattened.kind === 'ok' ? flattened.polylines : path.polylines;
}

function warpLocalPolyline(
  polyline: Polyline,
  transform: Transform,
  map: PointMap,
  toOutput: (point: Vec2) => Vec2,
): Polyline {
  const world = polyline.points.map((point) => applyTransform(point, transform));
  const points = warpWorldPoints(world, polyline.closed, map).map(toOutput);
  if (polyline.closed && points.length > 1) points[points.length - 1] = points[0] as Vec2;
  return { closed: polyline.closed, points };
}

function hasExactCurves(path: ColoredPath): boolean {
  return (
    path.curves?.some((curve) => curve.segments.some((segment) => segment.kind !== 'line')) === true
  );
}

function invertibleTransform(transform: Transform): boolean {
  return (
    Number.isFinite(transform.scaleX) &&
    Number.isFinite(transform.scaleY) &&
    transform.scaleX !== 0 &&
    transform.scaleY !== 0
  );
}

// The inverse of applyTransform: untranslate, unrotate, unmirror, unscale.
function worldToLocal(point: Vec2, transform: Transform): Vec2 {
  const dx = point.x - transform.x;
  const dy = point.y - transform.y;
  const rad = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let x = dx * cos + dy * sin;
  let y = -dx * sin + dy * cos;
  if (transform.mirrorX) x = -x;
  if (transform.mirrorY) y = -y;
  return { x: x / transform.scaleX, y: y / transform.scaleY };
}

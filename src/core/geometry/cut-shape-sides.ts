// The two sides of a cut for Cut Shapes (LightBurn gap LBG-T08). Each of an
// object's paths is cut on its own, in world millimetres, so every piece keeps
// the colour, operations and stroke of the path it came from. Closed contours
// are cut as the region they fill (the path's own fill rule); open contours
// are clipped as lines, split where they cross the cutter's outline.

import { ClipperD, ClipType, differenceD, FillRule, intersectD, unionD } from 'clipper2-ts';
import { areaD, type PathD, type PathsD } from 'clipper2-ts';
import { ok, type Result } from '../result';
import { isClosedEnough, type ColoredPath, type Polyline } from '../scene';
import { canonicalizeVectorPaths } from './vector-path-canonical';
import { VECTOR_PATH_PRECISION_DECIMALS } from './vector-path-regions';
import {
  materializeVectorObject,
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
  type VectorOpError,
  type VectorSceneObject,
} from './vector-path-tools';

type PathStyle = Pick<ColoredPath, 'color' | 'operationIds' | 'strokeWidthMm' | 'strokeTransform'>;

export type CutBatch = PathStyle & {
  readonly closed: PathsD;
  readonly open: PathsD;
};

export type CutSides = {
  readonly inside: ReadonlyArray<ColoredPath>;
  readonly outside: ReadonlyArray<ColoredPath>;
};

// Slivers the 1 µm grid leaves along a shared edge are not pieces.
const MIN_PIECE_AREA_MM2 = 1e-6;
const MIN_PIECE_LENGTH_MM = 1e-4;
const PRECISION = VECTOR_PATH_PRECISION_DECIMALS;

/** Each path of the object in world millimetres: its filled region and its open contours. */
export function cutBatches(
  object: VectorSceneObject,
): Result<ReadonlyArray<CutBatch>, VectorOpError> {
  const materialized = tryVectorOp(() => materializeVectorObject(object));
  if (materialized.kind === 'error') return materialized;
  const batches: CutBatch[] = [];
  for (const path of materialized.value.paths) {
    const closedRaw = path.polylines.filter(isClosedEnough).map(polylineToPathD);
    const open = path.polylines
      .filter((polyline) => !isClosedEnough(polyline) && polyline.points.length >= 2)
      .map((polyline) => polyline.points.map((point) => ({ x: point.x, y: point.y })));
    const fillRule = path.fillRule === 'nonzero' ? FillRule.NonZero : FillRule.EvenOdd;
    const closed = tryVectorOp(() =>
      closedRaw.length === 0
        ? []
        : canonicalizeVectorPaths(unionD(closedRaw, [], fillRule, PRECISION)),
    );
    if (closed.kind === 'error') return closed;
    if (closed.value.length === 0 && open.length === 0) continue;
    batches.push({ ...pathStyle(path), closed: closed.value, open });
  }
  return ok(batches);
}

/** The region a closed shape fills, or null when it has an open contour or no area. */
export function cutterRegion(object: VectorSceneObject): Result<PathsD | null, VectorOpError> {
  const batches = cutBatches(object);
  if (batches.kind === 'error') return batches;
  if (batches.value.some((batch) => batch.open.length > 0)) return ok(null);
  const all = batches.value.flatMap((batch) => batch.closed);
  if (all.length === 0) return ok(null);
  const region = tryVectorOp(() =>
    canonicalizeVectorPaths(unionD(all, [], FillRule.NonZero, PRECISION)),
  );
  if (region.kind === 'error') return region;
  return ok(region.value.length === 0 ? null : region.value);
}

/** The object's paths inside the cutter region and outside it. */
export function cutSides(
  object: VectorSceneObject,
  cutter: PathsD,
): Result<CutSides, VectorOpError> {
  const batches = cutBatches(object);
  if (batches.kind === 'error') return batches;
  const inside: ColoredPath[] = [];
  const outside: ColoredPath[] = [];
  for (const batch of batches.value) {
    const split = splitBatch(batch, cutter);
    if (split.kind === 'error') return split;
    if (split.value.inside !== null) inside.push(split.value.inside);
    if (split.value.outside !== null) outside.push(split.value.outside);
  }
  return ok({ inside, outside });
}

function splitBatch(
  batch: CutBatch,
  cutter: PathsD,
): Result<
  { readonly inside: ColoredPath | null; readonly outside: ColoredPath | null },
  VectorOpError
> {
  const regions = tryVectorOp(() => ({
    inside: closedPieces(intersectD(batch.closed, cutter, FillRule.NonZero, PRECISION)),
    outside: closedPieces(differenceD(batch.closed, cutter, FillRule.NonZero, PRECISION)),
    openInside: openPieces(clipOpen(batch.open, cutter, ClipType.Intersection)),
    openOutside: openPieces(clipOpen(batch.open, cutter, ClipType.Difference)),
  }));
  if (regions.kind === 'error') return regions;
  const { inside, outside, openInside, openOutside } = regions.value;
  return ok({
    inside: sidePath(batch, [...inside, ...openInside]),
    outside: sidePath(batch, [...outside, ...openOutside]),
  });
}

function clipOpen(open: PathsD, cutter: PathsD, clipType: ClipType): PathsD {
  if (open.length === 0) return [];
  const clipper = new ClipperD(PRECISION);
  clipper.addOpenSubjectPaths(open);
  clipper.addClipPaths(cutter);
  const closedOut: PathsD = [];
  const openOut: PathsD = [];
  clipper.execute(clipType, FillRule.NonZero, closedOut, openOut);
  return openOut;
}

function closedPieces(paths: PathsD): ReadonlyArray<Polyline> {
  return canonicalizeVectorPaths(paths)
    .filter((path) => Math.abs(areaD(path)) >= MIN_PIECE_AREA_MM2)
    .map(pathDToPolyline);
}

function openPieces(paths: PathsD): ReadonlyArray<Polyline> {
  return paths
    .filter((path) => pathLength(path) >= MIN_PIECE_LENGTH_MM)
    .map((path) => ({ closed: false, points: path.map((point) => ({ x: point.x, y: point.y })) }));
}

function pathLength(path: PathD): number {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    if (a !== undefined && b !== undefined) length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

function sidePath(batch: CutBatch, polylines: ReadonlyArray<Polyline>): ColoredPath | null {
  return polylines.length === 0 ? null : { ...pathStyle(batch), polylines };
}

function pathStyle(path: PathStyle): PathStyle {
  return {
    color: path.color,
    ...(path.operationIds === undefined ? {} : { operationIds: path.operationIds }),
    ...(path.strokeWidthMm === undefined ? {} : { strokeWidthMm: path.strokeWidthMm }),
    ...(path.strokeTransform === undefined ? {} : { strokeTransform: path.strokeTransform }),
  };
}

import { FillRule, unionD, type PathsD } from 'clipper2-ts';
import { ok, type Result } from '../result';
import type { ColoredPath } from '../scene';
import { canonicalizeVectorPaths } from './vector-path-canonical';
import {
  isClosedPolygon,
  materializeVectorObject,
  polylineToPathD,
  tryVectorOp,
  type VectorOpError,
  type VectorSceneObject,
} from './vector-path-tools';

// Match the repository's existing filled-region normalization grid (1 µm).
// Clipper's two-decimal default would otherwise quantize sub-centimeter detail
// differently between geometry tools and compiled fill.
export const VECTOR_PATH_PRECISION_DECIMALS = 3;

export type NormalizedVectorPathBatch = Pick<
  ColoredPath,
  'color' | 'operationIds' | 'strokeWidthMm'
> & {
  readonly paths: PathsD;
};

/** Normalize each render/fill batch under the same rule used by the canvas and
 * CAM: TextObject outlines are non-zero; every ordinary artwork ColoredPath is
 * an independent even-odd batch. */
export function normalizeVectorObjectBatches(
  object: VectorSceneObject,
): Result<ReadonlyArray<NormalizedVectorPathBatch>, VectorOpError> {
  const materializedResult = tryVectorOp(() => materializeVectorObject(object));
  if (materializedResult.kind === 'error') return materializedResult;
  const materialized = materializedResult.value;
  const fillRule = object.kind === 'text' ? FillRule.NonZero : FillRule.EvenOdd;
  const batches: NormalizedVectorPathBatch[] = [];
  for (const path of materialized.paths) {
    const raw: PathsD = [];
    for (const polyline of path.polylines) {
      if (!isClosedPolygon(polyline)) {
        return {
          kind: 'error',
          error: {
            kind: 'open-contours',
            message: 'Boolean, offset, and weld operations need closed contours only.',
          },
        };
      }
      raw.push(polylineToPathD(polyline));
    }
    if (raw.length === 0) continue;
    const normalized = tryVectorOp(() =>
      canonicalizeVectorPaths(unionD(raw, [], fillRule, VECTOR_PATH_PRECISION_DECIMALS)),
    );
    if (normalized.kind === 'error') return normalized;
    if (normalized.value.length === 0) continue;
    const operationIds = path.operationIds ?? materialized.operationIds;
    batches.push({
      color: path.color,
      ...(operationIds === undefined ? {} : { operationIds }),
      ...(path.strokeWidthMm === undefined ? {} : { strokeWidthMm: path.strokeWidthMm }),
      paths: normalized.value,
    });
  }
  return ok(batches);
}

/** Union already-normalized render batches into one visible object region. */
export function normalizeVectorObjectRegion(
  object: VectorSceneObject,
): Result<PathsD, VectorOpError> {
  const batches = normalizeVectorObjectBatches(object);
  if (batches.kind === 'error') return batches;
  if (batches.value.length === 0) return ok([]);
  const onlyBatch = batches.value[0];
  if (batches.value.length === 1 && onlyBatch !== undefined) return ok(onlyBatch.paths);
  return tryVectorOp(() =>
    canonicalizeVectorPaths(
      unionD(
        batches.value.flatMap((batch) => batch.paths),
        [],
        FillRule.NonZero,
        VECTOR_PATH_PRECISION_DECIMALS,
      ),
    ),
  );
}

export function unionNormalizedRegions(
  regions: ReadonlyArray<PathsD>,
): Result<PathsD, VectorOpError> {
  const populated = regions.filter((region) => region.length > 0);
  if (populated.length === 0) return ok([]);
  if (populated.length === 1) return ok(populated[0] as PathsD);
  return tryVectorOp(() =>
    canonicalizeVectorPaths(
      unionD(
        populated.flatMap((region) => region),
        [],
        FillRule.NonZero,
        VECTOR_PATH_PRECISION_DECIMALS,
      ),
    ),
  );
}

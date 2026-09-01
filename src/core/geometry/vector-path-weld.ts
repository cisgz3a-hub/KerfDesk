import { FillRule, unionD, type PathsD } from 'clipper2-ts';
import { err, ok, type Result } from '../result';
import { IDENTITY_TRANSFORM, type ColoredPath, type ImportedSvg } from '../scene';
import { canonicalizeVectorPaths } from './vector-path-canonical';
import {
  normalizeVectorObjectBatches,
  VECTOR_PATH_PRECISION_DECIMALS,
  type NormalizedVectorPathBatch,
} from './vector-path-regions';
import {
  boundsForPaths,
  pathDToPolyline,
  tryVectorOp,
  type VectorOpError,
  type VectorSceneObject,
} from './vector-path-tools';

type WeldBatch = Pick<NormalizedVectorPathBatch, 'color' | 'operationIds' | 'strokeWidthMm'> & {
  readonly paths: PathsD;
};

export function weldVectorObjects(
  objects: ReadonlyArray<VectorSceneObject>,
  id: string,
): Result<ImportedSvg, VectorOpError> {
  const firstObject = objects[0];
  if (firstObject === undefined) {
    return err({
      kind: 'too-few-objects',
      message: 'Weld requires selected closed vector contours.',
    });
  }
  const grouped = collectWeldBatches(objects);
  if (grouped.kind === 'error') return grouped;
  const weldedPaths = weldBatches(grouped.value);
  if (weldedPaths.kind === 'error') return weldedPaths;
  if (weldedPaths.value.length === 0) {
    return err({ kind: 'empty-result', message: 'Welding these shapes produced an empty result.' });
  }
  return ok({
    ...commonObjectMetadata(objects),
    kind: 'imported-svg',
    id,
    source: 'Welded paths',
    bounds: boundsForPaths(weldedPaths.value) ?? firstObject.bounds,
    transform: IDENTITY_TRANSFORM,
    paths: weldedPaths.value,
  });
}

function collectWeldBatches(
  objects: ReadonlyArray<VectorSceneObject>,
): Result<Map<string, WeldBatch>, VectorOpError> {
  const grouped = new Map<string, WeldBatch>();
  for (const object of objects) {
    const normalized = normalizeVectorObjectBatches(object);
    if (normalized.kind === 'error') return normalized;
    for (const batch of normalized.value) {
      const operationIds = normalizedOperationIds(batch.operationIds);
      // One source path may intentionally run under several operations. Split
      // it into one Weld batch per root so an A+B path can union with A-only
      // geometry without changing the independent B run.
      const bindingSets = operationBindingSets(operationIds);
      for (const bindingSet of bindingSets) {
        const key = batchKey(batch.color, bindingSet, batch.strokeWidthMm);
        const existing = grouped.get(key);
        grouped.set(key, {
          color: batch.color,
          ...(bindingSet === undefined ? {} : { operationIds: bindingSet }),
          ...(batch.strokeWidthMm === undefined ? {} : { strokeWidthMm: batch.strokeWidthMm }),
          paths: [...(existing?.paths ?? []), ...batch.paths],
        });
      }
    }
  }
  return ok(grouped);
}

function operationBindingSets(
  operationIds: ReadonlyArray<string> | undefined,
): ReadonlyArray<ReadonlyArray<string> | undefined> {
  if (operationIds === undefined) return [undefined];
  if (operationIds.length === 0) return [[]];
  return operationIds.map((operationId) => [operationId]);
}

function weldBatches(
  grouped: ReadonlyMap<string, WeldBatch>,
): Result<ColoredPath[], VectorOpError> {
  const paths: ColoredPath[] = [];
  // Map insertion order is supplied by scene/source-operation order in the
  // state plan. Do not sort fresh string IDs: operation-10 would precede
  // operation-2 and silently change source-order output.
  for (const batch of grouped.values()) {
    const welded = tryVectorOp(() =>
      canonicalizeVectorPaths(
        unionD(batch.paths, [], FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS),
      ),
    );
    if (welded.kind === 'error') return welded;
    if (welded.value.length === 0) continue;
    paths.push({
      color: batch.color,
      ...(batch.operationIds === undefined ? {} : { operationIds: batch.operationIds }),
      ...(batch.strokeWidthMm === undefined ? {} : { strokeWidthMm: batch.strokeWidthMm }),
      polylines: welded.value.map(pathDToPolyline),
    });
  }
  return ok(paths);
}

function normalizedOperationIds(
  operationIds: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined {
  if (operationIds === undefined) return undefined;
  return [...new Set(operationIds)];
}

function batchKey(
  color: string,
  operationIds: ReadonlyArray<string> | undefined,
  strokeWidthMm: number | undefined,
): string {
  return JSON.stringify([color.toLowerCase(), operationIds ?? null, strokeWidthMm ?? null]);
}

function commonObjectMetadata(
  objects: ReadonlyArray<VectorSceneObject>,
): Pick<ImportedSvg, 'locked' | 'operationOverride' | 'powerScale'> {
  const first = objects[0];
  if (first === undefined) return {};
  if (objects.slice(1).some((object) => !objectMetadataEqual(first, object))) return {};
  return {
    ...(first.locked === undefined ? {} : { locked: first.locked }),
    ...(first.operationOverride === undefined
      ? {}
      : { operationOverride: first.operationOverride }),
    ...(first.powerScale === undefined ? {} : { powerScale: first.powerScale }),
  };
}

function objectMetadataEqual(left: VectorSceneObject, right: VectorSceneObject): boolean {
  return (
    left.locked === right.locked &&
    Object.is(left.powerScale, right.powerScale) &&
    operationOverrideEqual(left.operationOverride, right.operationOverride)
  );
}

function operationOverrideEqual(
  left: ImportedSvg['operationOverride'],
  right: ImportedSvg['operationOverride'],
): boolean {
  const leftKeys = Object.keys(left ?? {}).sort();
  const rightKeys = Object.keys(right ?? {}).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => {
      if (key !== rightKeys[index]) return false;
      return Object.is(left?.[key as keyof typeof left], right?.[key as keyof typeof right]);
    })
  );
}

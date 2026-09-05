import { err, ok, type Result } from '../result';
import {
  operationIdsForObject,
  pathUsesOperation,
  type ColoredPath,
  type ImportedSvg,
  type Layer,
} from '../scene';
import { dogboneVectorObject } from './dogbone';
import {
  boundsForPaths,
  materializeVectorObject,
  type VectorOpError,
  type VectorSceneObject,
} from './vector-path-tools';

/** Relieve each operation's own region. A path assigned to A and B participates
 * in each region, but geometry assigned only to A must never be rebound to B.
 * Paths of one operation stay together so its holes and overlapping rings retain
 * the same union semantics as the compiler. */
export function dogboneOperationRegions(
  object: VectorSceneObject,
  bitDiameterMm: number,
  operations: ReadonlyArray<Layer>,
): Result<ImportedSvg, VectorOpError> {
  const ids = operationIdsForObject(object, operations);
  if (ids.length === 0) return dogboneVectorObject(object, bitDiameterMm);
  const materialized = materializeVectorObject(object);
  const paths: ColoredPath[] = [];
  let changed = false;
  for (const operation of operations) {
    if (!ids.includes(operation.id)) continue;
    const regionPaths = materialized.paths.filter((path) =>
      pathUsesOperation(materialized, path, operation),
    );
    const result = dogboneVectorObject({ ...materialized, paths: regionPaths }, bitDiameterMm);
    if (result.kind === 'error' && result.error.kind === 'operation-failed') return result;
    if (result.kind === 'ok') changed = true;
    paths.push(
      ...(result.kind === 'ok' ? result.value.paths : regionPaths).map((path) => ({
        ...path,
        operationIds: [operation.id],
      })),
    );
  }
  if (!changed) return err({ kind: 'no-corners', message: 'No corners to relieve.' });
  // Keep geometry that has no live operation; do not accidentally make it output.
  paths.push(
    ...materialized.paths.filter(
      (path) => !operations.some((operation) => pathUsesOperation(materialized, path, operation)),
    ),
  );
  return ok({
    ...materialized,
    source: `${materialized.source.replace(/ \(paths\)$/, '')} (dogbone)`,
    bounds: boundsForPaths(paths) ?? materialized.bounds,
    paths,
  });
}

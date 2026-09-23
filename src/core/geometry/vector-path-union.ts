import { err, ok, type Result } from '../result';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import { normalizeVectorObjectRegion, unionNormalizedRegions } from './vector-path-regions';
import {
  boundsForPaths,
  pathDToPolyline,
  type VectorOpError,
  type VectorSceneObject,
} from './vector-path-tools';

/** Explicit silhouette union: discard source operation partitions only after the
 * operator has chosen the one operation that will own the resulting region. */
export function unionVectorObjects(
  objects: ReadonlyArray<VectorSceneObject>,
  operation: { readonly id: string; readonly color: string },
  id: string,
): Result<ImportedSvg, VectorOpError> {
  if (objects.length === 0) {
    return err({ kind: 'too-few-objects', message: 'Select closed vector shapes to union.' });
  }
  const regions = [];
  for (const object of objects) {
    const result = normalizeVectorObjectRegion(object);
    if (result.kind === 'error') return result;
    regions.push(result.value);
  }
  const union = unionNormalizedRegions(regions);
  if (union.kind === 'error') return union;
  const paths = [{ color: operation.color, polylines: union.value.map(pathDToPolyline) }];
  const bounds = boundsForPaths(paths);
  if (bounds === null) {
    return err({ kind: 'empty-result', message: 'These shapes have no closed area to union.' });
  }
  return ok({
    kind: 'imported-svg',
    id,
    source: 'Union silhouette',
    operationIds: [operation.id],
    bounds,
    transform: IDENTITY_TRANSFORM,
    paths,
  });
}

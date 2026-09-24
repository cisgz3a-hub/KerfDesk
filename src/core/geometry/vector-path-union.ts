import { err, ok, type Result } from '../result';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene';
import type { SceneGroup } from '../scene/scene';
import { selectionUnits } from '../scene/selection-units';
import { operandRegions } from './group-operand-region';
import { unionNormalizedRegions } from './vector-path-regions';
import {
  boundsForPaths,
  pathDToPolyline,
  type VectorOpError,
  type VectorSceneObject,
} from './vector-path-tools';

/** Explicit silhouette union: discard source operation partitions only after the
 * operator has chosen the one operation that will own the resulting region. A
 * group in `groups` joins as its one shape, holes included (ADR-377). */
export function unionVectorObjects(
  objects: ReadonlyArray<VectorSceneObject>,
  operation: { readonly id: string; readonly color: string },
  id: string,
  groups: ReadonlyArray<SceneGroup> = [],
): Result<ImportedSvg, VectorOpError> {
  if (objects.length === 0) {
    return err({ kind: 'too-few-objects', message: 'Select closed vector shapes to union.' });
  }
  const regions = operandRegions(selectionUnits(objects, groups).map((unit) => unit.objects));
  if (regions.kind === 'error') return regions;
  const union = unionNormalizedRegions(regions.value);
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

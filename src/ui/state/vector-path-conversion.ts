import type { ImportedSvg } from '../../core/scene';
import { materializedTabAnchors } from '../../core/geometry/materialized-tab-anchors';
import {
  materializeVectorObject,
  type VectorSceneObject,
} from '../../core/geometry/vector-path-tools';

/** Conversion changes the coordinate frame, not the physical placement of manual tabs. */
export function convertVectorObjectToPath(object: VectorSceneObject): ImportedSvg {
  const result = materializeVectorObject(object);
  return { ...result, ...materializedTabAnchors(object, result.paths) };
}

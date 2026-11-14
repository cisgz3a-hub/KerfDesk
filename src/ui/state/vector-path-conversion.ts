import type { ColoredPath, ImportedSvg } from '../../core/scene';
import { bakePathCurves } from '../../core/geometry/baked-path-curves';
import { materializedTabAnchors } from '../../core/geometry/materialized-tab-anchors';
import { transformAffine } from '../../core/geometry/shear-bake';
import {
  materializeVectorObject,
  type VectorSceneObject,
} from '../../core/geometry/vector-path-tools';

/**
 * Convert to Path: the object's placement is baked into world coordinates, and
 * its canonical curves are kept as curves (tools audit T1, T26-P2-1), so a
 * circle converts to a few arcs rather than its burn polyline. The polylines
 * are the same world flattening as before and stay one per curve, so tab
 * anchors and every polyline reader see what they saw. Conversion changes the
 * coordinate frame, not the physical placement of manual tabs.
 */
export function convertVectorObjectToPath(object: VectorSceneObject): ImportedSvg {
  const result = materializeVectorObject(object);
  const matrix = transformAffine(object.transform);
  const paths = result.paths.map((path, index): ColoredPath => {
    const curves = object.paths[index]?.curves;
    return curves === undefined ? path : { ...path, curves: bakePathCurves(curves, matrix) };
  });
  return { ...result, paths, ...materializedTabAnchors(object, paths) };
}

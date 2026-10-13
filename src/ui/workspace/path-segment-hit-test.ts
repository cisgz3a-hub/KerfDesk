// Which segment of editable vector artwork lies under the pointer, for the
// node tool's segment edits (insert node, delete segment, drag segment). The
// top-most visible, unlocked path wins, as it does for node picks.

import { nearestCurveSegment } from '../../core/geometry/curve-segment-edit';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import {
  polylineToCurveSubpath,
  sceneLayerVisibility,
  type ColoredPath,
  type CurveSubpath,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import type { PathSegmentRef } from '../state/path-segment-actions';
import { PATH_NODE_HIT_RADIUS_PX } from './path-node-hit-test';

export type PathSegmentHit = PathSegmentRef & { readonly point: Vec2 };

type EditablePathObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;

export function hitPathSegment(
  scene: Scene,
  point: Vec2,
  pxToMm: number,
  onlyObjectId?: string,
): PathSegmentHit | null {
  const radiusMm = Math.max(0, PATH_NODE_HIT_RADIUS_PX * pxToMm);
  const layers = sceneLayerVisibility.lookup(scene.layers);
  for (let index = scene.objects.length - 1; index >= 0; index -= 1) {
    const object = scene.objects[index];
    if (object === undefined || !isEditablePathObject(object)) continue;
    if (onlyObjectId !== undefined && object.id !== onlyObjectId) continue;
    if (!sceneLayerVisibility.hasObject(object, layers)) continue;
    const hit = hitObjectSegment(object, point, radiusMm, layers);
    if (hit !== null) return hit;
  }
  return null;
}

function hitObjectSegment(
  object: EditablePathObject,
  point: Vec2,
  radiusMm: number,
  layers: ReturnType<typeof sceneLayerVisibility.lookup>,
): PathSegmentHit | null {
  let best: PathSegmentHit | null = null;
  let bestDistance = radiusMm;
  for (const [pathIndex, path] of object.paths.entries()) {
    if (!sceneLayerVisibility.resolvePath(object, path, layers).visible) continue;
    for (const [curveIndex, curve] of pathCurves(path).entries()) {
      const hit = nearestCurveSegment(curve, object.transform, point);
      if (hit === null || hit.distance > bestDistance) continue;
      bestDistance = hit.distance;
      best = {
        objectId: object.id,
        pathIndex,
        curveIndex,
        segmentIndex: hit.segmentIndex,
        t: hit.t,
        point: hit.point,
      };
    }
  }
  return best;
}

function pathCurves(path: ColoredPath): ReadonlyArray<CurveSubpath> {
  return path.curves ?? path.polylines.map(polylineToCurveSubpath);
}

function isEditablePathObject(object: SceneObject): object is EditablePathObject {
  if (object.locked === true || isBooleanCompoundObject(object)) return false;
  if (object.kind === 'imported-svg' || object.kind === 'traced-image') return true;
  return object.kind === 'shape' && object.spec.kind === 'polyline';
}

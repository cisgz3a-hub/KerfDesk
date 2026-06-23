import {
  applyTransform,
  type ColoredPath,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import type { PathNodeRef } from '../state/path-node-edit-actions';

export const PATH_NODE_HIT_RADIUS_PX = 8;

type EditablePathObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;

export function hitPathNode(scene: Scene, point: Vec2, pxToMm: number): PathNodeRef | null {
  const radiusMm = Math.max(0, PATH_NODE_HIT_RADIUS_PX * pxToMm);
  for (let objectIndex = scene.objects.length - 1; objectIndex >= 0; objectIndex -= 1) {
    const object = scene.objects[objectIndex];
    if (object === undefined || !isEditablePathObject(object)) continue;
    const hit = hitObjectPathNode(object, point, radiusMm);
    if (hit !== null) return hit;
  }
  return null;
}

function hitObjectPathNode(
  object: EditablePathObject,
  point: Vec2,
  radiusMm: number,
): PathNodeRef | null {
  const maxDistanceSq = radiusMm * radiusMm;
  let best: { readonly ref: PathNodeRef; readonly distanceSq: number } | null = null;
  for (let pathIndex = 0; pathIndex < object.paths.length; pathIndex += 1) {
    const path = object.paths[pathIndex];
    if (path === undefined) continue;
    for (let polylineIndex = 0; polylineIndex < path.polylines.length; polylineIndex += 1) {
      const polyline = path.polylines[polylineIndex];
      if (polyline === undefined) continue;
      for (let pointIndex = 0; pointIndex < polyline.points.length; pointIndex += 1) {
        const node = polyline.points[pointIndex];
        if (node === undefined) continue;
        const distanceSq = squaredDistance(point, applyTransform(node, object.transform));
        if (distanceSq > maxDistanceSq) continue;
        if (best !== null && distanceSq >= best.distanceSq) continue;
        best = {
          distanceSq,
          ref: { objectId: object.id, pathIndex, polylineIndex, pointIndex },
        };
      }
    }
  }
  return best?.ref ?? null;
}

function isEditablePathObject(object: SceneObject): object is EditablePathObject {
  if (object.locked === true) return false;
  if (object.kind === 'imported-svg' || object.kind === 'traced-image') return true;
  return object.kind === 'shape' && object.spec.kind === 'polyline';
}

function squaredDistance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

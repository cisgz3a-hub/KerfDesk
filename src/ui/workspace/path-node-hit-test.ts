import {
  applyTransform,
  sceneObjectHasVisibleLayerFromMap,
  type ColoredPath,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import type { PathNodeRef } from '../state/path-node-edit-actions';

export const PATH_NODE_HIT_RADIUS_PX = 8;

type EditablePathObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;
type LayerVisibility = { readonly visible: boolean };
type BestPathNodeHit = { readonly ref: PathNodeRef; readonly distanceSq: number };

export function hitPathNode(scene: Scene, point: Vec2, pxToMm: number): PathNodeRef | null {
  const radiusMm = Math.max(0, PATH_NODE_HIT_RADIUS_PX * pxToMm);
  const layerByColor = new Map(scene.layers.map((layer) => [layer.color, layer]));
  for (let objectIndex = scene.objects.length - 1; objectIndex >= 0; objectIndex -= 1) {
    const object = scene.objects[objectIndex];
    if (object === undefined || !isEditablePathObject(object)) continue;
    if (!sceneObjectHasVisibleLayerFromMap(object, layerByColor)) continue;
    const hit = hitObjectPathNode(object, point, radiusMm, layerByColor);
    if (hit !== null) return hit;
  }
  return null;
}

function hitObjectPathNode(
  object: EditablePathObject,
  point: Vec2,
  radiusMm: number,
  layerByColor: ReadonlyMap<string, LayerVisibility>,
): PathNodeRef | null {
  const maxDistanceSq = radiusMm * radiusMm;
  let best: BestPathNodeHit | null = null;
  for (let pathIndex = 0; pathIndex < object.paths.length; pathIndex += 1) {
    const path = object.paths[pathIndex];
    if (path === undefined) continue;
    if (layerByColor.get(path.color)?.visible === false) continue;
    const hit = hitPathNodes(object, path, pathIndex, point, maxDistanceSq);
    if (hit === null) continue;
    if (best !== null && hit.distanceSq >= best.distanceSq) continue;
    best = hit;
  }
  return best?.ref ?? null;
}

function hitPathNodes(
  object: EditablePathObject,
  path: ColoredPath,
  pathIndex: number,
  point: Vec2,
  maxDistanceSq: number,
): BestPathNodeHit | null {
  let best: BestPathNodeHit | null = null;
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
  return best;
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

import {
  applyTransform,
  curveControlPoint,
  curveNodeCount,
  curveNodePoint,
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

export function hitPathNode(
  scene: Scene,
  point: Vec2,
  pxToMm: number,
  selectedNodes: ReadonlyArray<PathNodeRef> = [],
): PathNodeRef | null {
  const radiusMm = Math.max(0, PATH_NODE_HIT_RADIUS_PX * pxToMm);
  const layerByColor = new Map(
    scene.layers.flatMap((layer) => [[layer.id, layer] as const, [layer.color, layer] as const]),
  );
  for (let objectIndex = scene.objects.length - 1; objectIndex >= 0; objectIndex -= 1) {
    const object = scene.objects[objectIndex];
    if (object === undefined || !isEditablePathObject(object)) continue;
    if (!sceneObjectHasVisibleLayerFromMap(object, layerByColor)) continue;
    const hit = hitObjectPathNode(object, point, radiusMm, layerByColor, selectedNodes);
    if (hit !== null) return hit;
  }
  return null;
}

function hitObjectPathNode(
  object: EditablePathObject,
  point: Vec2,
  radiusMm: number,
  layerByColor: ReadonlyMap<string, LayerVisibility>,
  selectedNodes: ReadonlyArray<PathNodeRef>,
): PathNodeRef | null {
  const maxDistanceSq = radiusMm * radiusMm;
  let best: BestPathNodeHit | null = null;
  for (let pathIndex = 0; pathIndex < object.paths.length; pathIndex += 1) {
    const path = object.paths[pathIndex];
    if (path === undefined) continue;
    const operationIds = path.operationIds ?? object.operationIds;
    const visible =
      operationIds === undefined
        ? layerByColor.get(path.color)?.visible !== false
        : operationIds.some((id) => layerByColor.get(id)?.visible !== false);
    if (!visible) continue;
    const hit = hitPathNodes(object, path, pathIndex, point, maxDistanceSq, selectedNodes);
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
  selectedNodes: ReadonlyArray<PathNodeRef>,
): BestPathNodeHit | null {
  if (path.curves !== undefined) {
    return hitCurveNodes(object, path, pathIndex, point, maxDistanceSq, selectedNodes);
  }
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

// Traverses curve anchors plus the selected anchors' optional controls in one
// distance ordering so overlapping handles always resolve deterministically.
// eslint-disable-next-line complexity
function hitCurveNodes(
  object: EditablePathObject,
  path: ColoredPath,
  pathIndex: number,
  point: Vec2,
  maxDistanceSq: number,
  selectedNodes: ReadonlyArray<PathNodeRef>,
): BestPathNodeHit | null {
  let best: BestPathNodeHit | null = null;
  for (let curveIndex = 0; curveIndex < (path.curves?.length ?? 0); curveIndex += 1) {
    const curve = path.curves?.[curveIndex];
    if (curve === undefined) continue;
    for (let nodeIndex = 0; nodeIndex < curveNodeCount(curve); nodeIndex += 1) {
      const anchor = curveNodePoint(curve, nodeIndex);
      if (anchor !== null) {
        best = nearerHit(best, point, applyTransform(anchor, object.transform), maxDistanceSq, {
          objectId: object.id,
          pathIndex,
          polylineIndex: curveIndex,
          pointIndex: nodeIndex,
          geometry: 'curve',
        });
      }
    }
    for (const selected of selectedNodes) {
      if (
        selected.objectId !== object.id ||
        selected.pathIndex !== pathIndex ||
        selected.polylineIndex !== curveIndex ||
        selected.geometry !== 'curve' ||
        selected.handle !== undefined
      ) {
        continue;
      }
      for (const side of ['incoming', 'outgoing'] as const) {
        const control = curveControlPoint(curve, selected.pointIndex, side);
        if (control === null) continue;
        best = nearerHit(best, point, applyTransform(control, object.transform), maxDistanceSq, {
          ...selected,
          handle: side,
        });
      }
    }
  }
  return best;
}

function nearerHit(
  current: BestPathNodeHit | null,
  pointer: Vec2,
  node: Vec2,
  maxDistanceSq: number,
  ref: PathNodeRef,
): BestPathNodeHit | null {
  const distanceSq = squaredDistance(pointer, node);
  if (distanceSq > maxDistanceSq || (current !== null && distanceSq >= current.distanceSq)) {
    return current;
  }
  return { distanceSq, ref };
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

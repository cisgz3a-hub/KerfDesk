// Where a pen drawing may continue an existing path: an open endpoint of
// unlocked, visible, editable vector artwork near the first click.

import {
  applyTransform,
  curveNodeCount,
  curveNodePoint,
  polylineToCurveSubpath,
  sceneLayerVisibility,
  type Project,
  type Vec2,
} from '../../core/scene';
import { isPathEditable } from '../state/path-cleanup-actions';
import type { PenContinuation } from '../state/ui-store';

export function penEndpointAt(
  project: Project,
  point: Vec2,
  radiusMm: number,
): { readonly continuation: PenContinuation; readonly point: Vec2 } | null {
  const scene = project.scene;
  const layers = sceneLayerVisibility.lookup(scene.layers);
  let best: { continuation: PenContinuation; point: Vec2 } | null = null;
  let bestDistance = radiusMm;
  for (let index = scene.objects.length - 1; index >= 0; index -= 1) {
    const object = scene.objects[index];
    if (object === undefined || object.locked === true || !isPathEditable(object)) continue;
    if (!sceneLayerVisibility.hasObject(object, layers)) continue;
    object.paths.forEach((path, pathIndex) => {
      (path.curves ?? path.polylines.map(polylineToCurveSubpath)).forEach((curve, curveIndex) => {
        if (curve.closed || curve.segments.length === 0) return;
        for (const node of [0, curveNodeCount(curve) - 1]) {
          const local = curveNodePoint(curve, node);
          if (local === null) continue;
          const world = applyTransform(local, object.transform);
          const distance = Math.hypot(world.x - point.x, world.y - point.y);
          if (distance > bestDistance) continue;
          bestDistance = distance;
          best = {
            continuation: { objectId: object.id, pathIndex, curveIndex, node },
            point: world,
          };
        }
      });
    });
  }
  return best;
}

/** The other end of the contour being continued, in world space. */
export function continuationOtherEnd(project: Project, from: PenContinuation): Vec2 | null {
  const object = project.scene.objects.find((candidate) => candidate.id === from.objectId);
  const path = object !== undefined && 'paths' in object ? object.paths[from.pathIndex] : undefined;
  const curve =
    path === undefined
      ? undefined
      : (path.curves ?? path.polylines.map(polylineToCurveSubpath))[from.curveIndex];
  if (object === undefined || curve === undefined) return null;
  const other = curveNodePoint(curve, from.node === 0 ? curveNodeCount(curve) - 1 : 0);
  return other === null ? null : applyTransform(other, object.transform);
}

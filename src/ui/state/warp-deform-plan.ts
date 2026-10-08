import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
// What a Warp or Deform (LBG-T06) does to the scene, shared by the live canvas
// preview and Apply so the user gets exactly what they saw. Imported and
// traced artwork and drawn lines keep their object, transform and settings;
// only their paths change. Text and drawn rectangles, ellipses, polygons,
// stars and barcodes rebuild their paths from their settings, so they become
// plain paths first, as Convert to Path makes them, keeping their id, their
// operation bindings and their tab anchors.

import {
  initialWarpDeformHandles,
  warpDeformBox,
  warpDeformMap,
  warpDeformStretch,
  type PointMap,
  type WarpDeformGrid,
} from '../../core/geometry/warp-deform-map';
import { warpObjectPaths } from '../../core/geometry/warp-deform-paths';
import {
  boundsForPaths,
  isVectorPathObject,
  materializeVectorObject,
  type VectorSceneObject,
} from '../../core/geometry/vector-path-tools';
import type { Scene } from '../../core/scene/scene';
import type { Bounds, SceneObject } from '../../core/scene/scene-object';
import { applyTransform } from '../../core/scene/transform';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import type { WarpDeformRequest } from './warp-deform-session';

export type WarpDeformPlan = {
  /** The scene's objects with the warped ones replaced, in scene order. */
  readonly objects: ReadonlyArray<SceneObject>;
  readonly warped: number;
  readonly convertedText: number;
  readonly convertedShapes: number;
  readonly curvesFlattened: boolean;
};

type WarpedObject = {
  readonly object: SceneObject;
  readonly converted: 'text' | 'shape' | null;
  readonly curvesFlattened: boolean;
};

/** The artwork Warp and Deform bend: unlocked vector objects in the selection. */
export function warpDeformTargets(
  scene: Scene,
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<VectorSceneObject> {
  const ids = new Set(selectedIds);
  return scene.objects.filter(
    (object): object is VectorSceneObject =>
      ids.has(object.id) &&
      object.locked !== true &&
      !isBooleanCompoundObject(object) &&
      isVectorPathObject(object),
  );
}

/** A fresh session on the selection, with the handles on its box, or null when nothing can bend. */
export function warpDeformRequestForSelection(
  scene: Scene,
  selectedIds: ReadonlyArray<string>,
  grid: WarpDeformGrid,
): WarpDeformRequest | null {
  const targets = warpDeformTargets(scene, selectedIds);
  const bounds = worldBounds(targets);
  if (bounds === null) return null;
  const box = warpDeformBox(bounds);
  return {
    grid,
    objectIds: targets.map((object) => object.id),
    box,
    handles: initialWarpDeformHandles(grid, box),
  };
}

export function planWarpDeform(scene: Scene, request: WarpDeformRequest): WarpDeformPlan {
  const map = warpDeformMap(request.grid, request.box, request.handles);
  const stretch = warpDeformStretch(map, request.box);
  const ids = new Set(request.objectIds);
  let warped = 0;
  let convertedText = 0;
  let convertedShapes = 0;
  let curvesFlattened = false;
  const objects = scene.objects.map((object) => {
    if (isBooleanCompoundObject(object)) return object;
    if (!ids.has(object.id) || object.locked === true || !isVectorPathObject(object)) {
      return object;
    }
    const result = warpSceneObject(object, map, stretch);
    warped += 1;
    if (result.converted === 'text') convertedText += 1;
    if (result.converted === 'shape') convertedShapes += 1;
    curvesFlattened = curvesFlattened || result.curvesFlattened;
    return result.object;
  });
  return { objects, warped, convertedText, convertedShapes, curvesFlattened };
}

function warpSceneObject(object: VectorSceneObject, map: PointMap, stretch: number): WarpedObject {
  if (object.kind === 'imported-svg' || object.kind === 'traced-image') {
    const result = warpObjectPaths(object.paths, object.transform, map, stretch);
    return {
      object: {
        ...object,
        paths: result.paths,
        transform: result.transform,
        bounds: boundsForPaths(result.paths) ?? object.bounds,
      },
      converted: null,
      curvesFlattened: result.curvesFlattened,
    };
  }
  if (object.kind === 'shape' && object.spec.kind === 'polyline') {
    const result = warpObjectPaths(object.paths, object.transform, map, stretch);
    const synced =
      result.transform === object.transform
        ? synchronizePolylineShapeGeometry(
            object,
            result.paths,
            boundsForPaths(result.paths) ?? object.bounds,
          )
        : null;
    if (synced !== null) {
      return { object: synced, converted: null, curvesFlattened: result.curvesFlattened };
    }
  }
  return convertAndWarp(object, map, stretch);
}

// Convert to Path's object with the warped world polylines in place of its own
// flattening. Both keep one path per source path in the same order.
function convertAndWarp(object: VectorSceneObject, map: PointMap, stretch: number): WarpedObject {
  const converted = materializeVectorObject(object, object.id);
  const result = warpObjectPaths(object.paths, object.transform, map, stretch, 'world');
  const paths = converted.paths.map((path, index) => ({
    ...path,
    polylines: result.paths[index]?.polylines ?? path.polylines,
  }));
  return {
    object: {
      ...converted,
      paths,
      bounds: boundsForPaths(paths) ?? converted.bounds,
      ...(object.cncTabAnchors === undefined ? {} : { cncTabAnchors: object.cncTabAnchors }),
      ...(object.laserTabAnchors === undefined ? {} : { laserTabAnchors: object.laserTabAnchors }),
    },
    converted: object.kind === 'text' ? 'text' : 'shape',
    curvesFlattened: result.curvesFlattened,
  };
}

function worldBounds(objects: ReadonlyArray<VectorSceneObject>): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const object of objects) {
    for (const path of object.paths) {
      for (const polyline of path.polylines) {
        for (const local of polyline.points) {
          const point = applyTransform(local, object.transform);
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

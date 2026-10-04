import {
  applyTransform,
  flattenColoredPathCurves,
  sceneLayerVisibility,
  type AABB,
  type ColoredPath,
  type Project,
} from '../../core/scene';
import { transformedBBox } from '../../core/scene/hit-test';
import {
  resolveObjectDisplay,
  type ObjectDisplay,
  type VectorSceneObject,
} from '../workspace/object-display';
import type { DisplayPolylineCache, DisplayPolylines } from '../workspace/display-polylines';
import type { ViewTransform } from '../workspace/view-transform';
import { remoteBounds } from './projections';
import type { RemoteBounds } from './types';
import {
  validatedPreviewObject,
  reservePreviewPoints,
  validPreviewPoint,
  previewTooLarge,
  invalidGeometry,
  PREVIEW_POINT_LIMIT,
  PreviewUnavailable,
  type PreviewPointBudget,
} from './preview-validation';
export { PREVIEW_POINT_LIMIT, PreviewUnavailable } from './preview-validation';

export const PREVIEW_OBJECT_LIMIT = 200;
export type PreviewGeometry = {
  readonly objects: readonly { object: VectorSceneObject; display: ObjectDisplay }[];
  readonly bounds?: RemoteBounds;
  readonly extent: AABB;
};
const EMPTY_EXTENT = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

/** The same design paths, fills and transforms as the local workspace, with no sampling fallback. */
export function resolvePreviewGeometry(project: Project, sizePx: number): PreviewGeometry {
  const scene = project.scene;
  if (scene.objects.length > PREVIEW_OBJECT_LIMIT || scene.layers.length > PREVIEW_OBJECT_LIMIT)
    throw new PreviewUnavailable('This workspace is too large for a remote artwork preview.');
  const layers = sceneLayerVisibility.lookup(scene.layers);
  const budget = { points: 0 };
  const visible = scene.objects
    .filter((object) => sceneLayerVisibility.hasObject(object, layers))
    .map((object) => validatedPreviewObject(object, budget));
  let extent: AABB | undefined;
  for (const object of visible) {
    const bounds = transformedBBox(object);
    extent = union(extent, bounds);
  }
  const view = previewView(extent ?? EMPTY_EXTENT, sizePx);
  const cache = strictCache();
  const displayBudget = { points: 0 };
  const objects: { object: VectorSceneObject; display: ObjectDisplay }[] = [];
  let actualExtent: AABB | undefined;
  for (const object of visible) {
    const display = resolveObjectDisplay(object, layers, view, cache, 'design');
    if (display.isSimplified) previewTooLarge();
    actualExtent = extendDisplayExtent(object, display, displayBudget, actualExtent);
    objects.push({ object, display });
  }
  const bounds = actualExtent === undefined ? undefined : remoteBounds(actualExtent);
  if (actualExtent !== undefined && bounds === undefined) invalidGeometry();
  return {
    objects,
    ...(bounds === undefined ? {} : { bounds }),
    extent: actualExtent ?? EMPTY_EXTENT,
  };
}

function extendDisplayExtent(
  object: VectorSceneObject,
  display: ObjectDisplay,
  budget: PreviewPointBudget,
  extent: AABB | undefined,
): AABB | undefined {
  for (const path of display.paths) {
    for (const polyline of path.display.polylines) {
      reservePreviewPoints(budget, polyline.points.length);
      for (const raw of polyline.points) {
        const point = applyTransform(raw, object.transform);
        if (!validPreviewPoint(point)) invalidGeometry();
        extent = union(extent, { minX: point.x, maxX: point.x, minY: point.y, maxY: point.y });
      }
    }
  }
  return extent;
}

export function previewView(extent: AABB, sizePx: number): ViewTransform {
  const width = Math.max(1, extent.maxX - extent.minX);
  const height = Math.max(1, extent.maxY - extent.minY);
  const scale = (sizePx - 32) / Math.max(width, height);
  return {
    scale,
    offsetX: (sizePx - width * scale) / 2 - extent.minX * scale,
    offsetY: (sizePx - height * scale) / 2 - extent.minY * scale,
  };
}

function strictCache(): DisplayPolylineCache {
  const flatten = (path: ColoredPath, toleranceMm: number): DisplayPolylines => {
    const flattened = flattenColoredPathCurves(path, {
      toleranceMm,
      segmentBudget: PREVIEW_POINT_LIMIT,
    });
    if (flattened.kind !== 'ok') previewTooLarge();
    return {
      polylines: flattened.polylines,
      segmentCount: flattened.segmentCount,
      isSimplified: false,
    };
  };
  return {
    get: (polylines) => ({ polylines, segmentCount: 0, isSimplified: false }),
    getPath: flatten,
    getFillPath: flatten,
  };
}
function union(left: AABB | undefined, right: AABB): AABB {
  return left === undefined
    ? right
    : {
        minX: Math.min(left.minX, right.minX),
        minY: Math.min(left.minY, right.minY),
        maxX: Math.max(left.maxX, right.maxX),
        maxY: Math.max(left.maxY, right.maxY),
      };
}

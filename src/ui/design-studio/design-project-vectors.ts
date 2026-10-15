import type { Scene, SceneObject } from '../../core/scene';
import {
  sceneLayerVisibilityLookup,
  sceneObjectHasVisibleLayerFromMap,
} from '../../core/scene/visibility';
import { createDisplayPolylineCache } from '../workspace/display-polylines';
import { beginArtworkSpriteFrame } from '../workspace/artwork-sprite-cache';
import {
  drawObjectDisplay,
  isVectorSceneObject,
  resolveObjectDisplay,
} from '../workspace/object-display';
import type { DesignView } from './design-session';

const displayCache = createDisplayPolylineCache();

/** Saved artwork stays visible on a fresh profile; the live draft replaces its own applied objects. */
export function paintDesignProjectVectors(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  view: DesignView,
  draftObjectIds: ReadonlySet<string>,
  onReady?: () => void,
): void {
  beginArtworkSpriteFrame();
  const paintVector = createDesignVectorPainter(scene, view, draftObjectIds, onReady);
  for (const object of scene.objects) paintVector(ctx, object);
}

export function createDesignVectorPainter(
  scene: Scene,
  view: DesignView,
  draftObjectIds: ReadonlySet<string>,
  onReady?: () => void,
): (ctx: CanvasRenderingContext2D, object: SceneObject) => void {
  const layers = sceneLayerVisibilityLookup(scene.layers);
  const rasterView = {
    scale: view.pxPerMm,
    offsetX: -view.panXmm * view.pxPerMm,
    offsetY: -view.panYmm * view.pxPerMm,
  };
  return (ctx, object) => {
    if (!isVectorSceneObject(object) || draftObjectIds.has(object.id)) return;
    if (!sceneObjectHasVisibleLayerFromMap(object, layers)) return;
    const resolved = resolveObjectDisplay(object, layers, rasterView, displayCache, 'design');
    drawObjectDisplay(ctx, object, resolved, rasterView, onReady);
  };
}

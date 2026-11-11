import type { Scene } from '../../core/scene';
import { fillPoolRuns } from '../../core/scene/fill-operations';
import {
  sceneLayerVisibilityLookup,
  sceneObjectHasVisibleLayerFromMap,
} from '../../core/scene/visibility';
import { createDisplayPolylineCache } from '../workspace/display-polylines';
import { beginArtworkSpriteFrame } from '../workspace/artwork-sprite-cache';
import { createFillPoolPainter } from '../workspace/fill-pool-paint';
import { drawnBitmapBox, planFillPools, type ResolvedVector } from '../workspace/fill-pools';
import {
  drawObjectDisplay,
  isVectorSceneObject,
  resolveObjectDisplay,
} from '../workspace/object-display';
import type { DesignView } from './design-session';

const displayCache = createDisplayPolylineCache();

/** Paints the project's vectors in scene order, with photos (if any) drawn between by the caller. */
export type DesignVectorPainter = {
  /** The Fill pools planned before the object at this index, then the object if it is a vector. */
  readonly paintAt: (index: number) => void;
  /** Paint queued pools: call before drawing anything else (a photo) and once at the end. */
  readonly flush: () => void;
};

/** Saved artwork stays visible on a fresh profile; the live draft replaces its own applied objects. */
export function paintDesignProjectVectors(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  view: DesignView,
  draftObjectIds: ReadonlySet<string>,
  onReady?: () => void,
): void {
  beginArtworkSpriteFrame();
  const painter = createDesignVectorPainter(ctx, scene, view, draftObjectIds, onReady);
  scene.objects.forEach((_, index) => painter.paintAt(index));
  painter.flush();
}

/**
 * ADR-683 Amendment 4: a Fill operation paints as the one even-odd region it
 * burns, as on the workspace canvas. `photosDrawn`: the caller draws each
 * visible photo at its index, so a pool split by one keeps the drawing order.
 */
export function createDesignVectorPainter(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  view: DesignView,
  draftObjectIds: ReadonlySet<string>,
  onReady?: () => void,
  photosDrawn = false,
): DesignVectorPainter {
  const layers = sceneLayerVisibilityLookup(scene.layers);
  const rasterView = {
    scale: view.pxPerMm,
    offsetX: -view.panXmm * view.pxPerMm,
    offsetY: -view.panYmm * view.pxPerMm,
  };
  const entries = scene.objects.map((object): ResolvedVector | undefined => {
    if (!isVectorSceneObject(object) || draftObjectIds.has(object.id)) return undefined;
    if (!sceneObjectHasVisibleLayerFromMap(object, layers)) return undefined;
    const display = resolveObjectDisplay(object, layers, rasterView, displayCache, 'design');
    return { object, display };
  });
  const plan = planFillPools(
    entries,
    (index) => {
      const object = scene.objects[index];
      const drawn =
        photosDrawn &&
        object?.kind === 'raster-image' &&
        sceneObjectHasVisibleLayerFromMap(object, layers);
      return drawnBitmapBox(object, drawn);
    },
    fillPoolRuns(scene),
  );
  const pools = createFillPoolPainter(ctx, rasterView, () => null, onReady);
  return {
    flush: pools.flush,
    paintAt(index) {
      pools.paint(plan.poolsAt(index));
      const entry = entries[index];
      const display = plan.displayAt(index);
      if (entry === undefined || display === undefined) return;
      // An object whose fills its pool paints, and nothing else, draws nothing.
      if (display !== entry.display && display.paths.length === 0) return;
      pools.flush();
      drawObjectDisplay(ctx, entry.object, display, rasterView, onReady);
    },
  };
}

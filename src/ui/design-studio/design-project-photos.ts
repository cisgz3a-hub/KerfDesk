import type { Sketch } from '../../core/design';
import { applyTransform, type RasterImage, type Scene, type Vec2 } from '../../core/scene';
import { hitTestObject } from '../../core/scene/hit-test';
import {
  sceneLayerVisibilityLookup,
  sceneObjectHasVisibleLayerFromMap,
} from '../../core/scene/visibility';
import { canvasTheme } from '../theme/canvas-theme';
import { burnedImageAdjustments, drawRasterImage } from '../workspace/draw-raster';
import { hitTestSketch } from './design-hit-test';
import type { DesignView } from './design-session';
import { mmToPx } from './design-view';
import { createDesignVectorPainter } from './design-project-vectors';

export type DesignPhotoActions = {
  readonly selectedPhotoId?: string | null;
  readonly onSelectPhoto?: (id: string | null) => void;
  readonly onEditPhoto?: (id: string) => void;
};

/** The same project objects and coordinate frame as the workspace; no photo copies in a sketch. */
export function paintDesignProjectArtwork(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  view: DesignView,
  selectedPhotoId: string | null,
  onReady?: () => void,
  draftObjectIds: ReadonlySet<string> = new Set(),
): void {
  const layers = sceneLayerVisibilityLookup(scene.layers);
  const rasterView = {
    scale: view.pxPerMm,
    offsetX: -view.panXmm * view.pxPerMm,
    offsetY: -view.panYmm * view.pxPerMm,
  };
  const paintVector = createDesignVectorPainter(scene, view, draftObjectIds, onReady);
  for (const object of scene.objects) {
    if (object.kind !== 'raster-image') {
      paintVector(ctx, object);
      continue;
    }
    if (!sceneObjectHasVisibleLayerFromMap(object, layers)) continue;
    drawRasterImage(ctx, object, rasterView, {
      adjustments: burnedImageAdjustments(object, layers),
      ...(onReady === undefined ? {} : { onBitmapReady: onReady }),
    });
    if (object.id === selectedPhotoId) paintPhotoOutline(ctx, object, view);
  }
}

function paintPhotoOutline(
  ctx: CanvasRenderingContext2D,
  photo: RasterImage,
  view: DesignView,
): void {
  const b = photo.bounds;
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((point) => mmToPx(view, applyTransform(point, photo.transform)));
  ctx.save();
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  corners.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** Sketch geometry is painted above photos and retains first pick, including its interior. */
export function pickDesignPhoto(
  scene: Scene,
  sketch: Sketch,
  point: Vec2,
  toleranceMm: number,
): RasterImage | null {
  if (hitTestSketch(sketch, point, toleranceMm) !== null) return null;
  const layers = sceneLayerVisibilityLookup(scene.layers);
  for (let index = scene.objects.length - 1; index >= 0; index -= 1) {
    const object = scene.objects[index];
    if (object?.kind !== 'raster-image' || object.locked === true) continue;
    if (!sceneObjectHasVisibleLayerFromMap(object, layers)) continue;
    if (hitTestObject(layers, object, point).kind === 'primary') return object;
  }
  return null;
}

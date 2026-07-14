// F.2.c raster-engrave preview (ADR-028). Renders the dithered/grayscale
// burn simulation: darker pixel = more power = deeper burn.
//
// WYSIWYG by reusing the same processed-bitmap path used by image export.
// Rendered in scene space via drawBitmapAtTransform, so the machine-origin
// transform remains confined to G-code output.
//
// Only output-enabled image-mode layers render. `layer.visible` is ignored:
// preview shows what burns, not what is merely visible.

import type { DeviceProfile } from '../../core/devices';
import {
  outputOperationLayers,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { buildProcessedRasterBitmap, processedRasterDimensions } from '../raster/processed-bitmap';
import { drawBitmapAtTransform } from './draw-raster';
import type { ViewTransform } from './view-transform';

type PreviewCanvasCacheEntry = {
  readonly dataUrl: string;
  readonly canvas: HTMLCanvasElement | null;
};

type PendingPreviewBuild = {
  readonly dataUrl: string;
  readonly cancel: () => void;
};

export type RasterPreviewBuildScheduler = (work: () => void) => () => void;

type DrawRasterPreviewOptions = {
  readonly onRasterPreviewReady?: () => void;
  readonly scheduleBuild?: RasterPreviewBuildScheduler;
};

const previewCanvasCache = new Map<string, PreviewCanvasCacheEntry>();
const pendingPreviewBuilds = new Map<string, PendingPreviewBuild>();

export function drawRasterPreview(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
  options: DrawRasterPreviewOptions = {},
): void {
  pruneRasterPreviewCache(liveRasterPreviewDataUrls(project));
  for (const layer of project.scene.layers) {
    for (const operationLayer of outputOperationLayers(layer)) {
      if (operationLayer.mode !== 'image') continue;
      for (const obj of project.scene.objects) {
        if (obj.kind !== 'raster-image' || obj.color !== operationLayer.color) continue;
        if (obj.role === 'trace-source') continue;
        drawOnePreview(
          ctx,
          obj,
          operationLayer,
          project.device,
          view,
          imageMaskObjectFor(project, obj),
          options,
        );
      }
    }
  }
}

export function pruneRasterPreviewCache(liveDataUrls: ReadonlySet<string>): void {
  for (const [key, entry] of previewCanvasCache) {
    if (!liveDataUrls.has(entry.dataUrl)) previewCanvasCache.delete(key);
  }
  for (const [key, pending] of pendingPreviewBuilds) {
    if (liveDataUrls.has(pending.dataUrl)) continue;
    pending.cancel();
    pendingPreviewBuilds.delete(key);
  }
}

function drawOnePreview(
  ctx: CanvasRenderingContext2D,
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  view: ViewTransform,
  maskObject: SceneObject | null,
  options: DrawRasterPreviewOptions,
): void {
  const canvas = previewCanvasFor(obj, layer, device, maskObject, options);
  if (canvas === null) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  drawBitmapAtTransform(ctx, canvas, obj.bounds, obj.transform, view);
  ctx.restore();
}

function previewCanvasFor(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  maskObject: SceneObject | null,
  options: DrawRasterPreviewOptions,
): HTMLCanvasElement | null {
  const { pixelWidth, pixelHeight } = obj;
  if (pixelWidth <= 0 || pixelHeight <= 0) return null;
  const { width, height } = processedRasterDimensions(obj, layer);
  const key = `${obj.dataUrl}|${obj.lumaBase64 ?? ''}|${adjustmentKey(obj)}|${layer.negativeImage ? 'negative' : 'positive'}|${layer.passThrough ? 'pass' : 'resample'}|${layer.ditherAlgorithm}|${layer.minPower}-${layer.power}-${device.maxPowerS}|${layer.linesPerMm}|${width}x${height}|${maskCacheKey(maskObject)}`;
  const cached = previewCanvasCache.get(key);
  if (cached !== undefined) return cached.canvas;
  schedulePreviewCanvasBuild(key, obj, layer, device, maskObject, options);
  return previewCanvasCache.get(key)?.canvas ?? null;
}

function schedulePreviewCanvasBuild(
  key: string,
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  maskObject: SceneObject | null,
  options: DrawRasterPreviewOptions,
): void {
  if (pendingPreviewBuilds.has(key)) return;
  const scheduleBuild = options.scheduleBuild ?? scheduleRasterPreviewBuild;
  let completedSynchronously = false;
  const cancel = scheduleBuild(() => {
    pendingPreviewBuilds.delete(key);
    const canvas = buildPreviewCanvas(obj, layer, device, maskObject);
    previewCanvasCache.set(key, { dataUrl: obj.dataUrl, canvas });
    if (canvas !== null) options.onRasterPreviewReady?.();
    completedSynchronously = true;
  });
  if (completedSynchronously) return;
  pendingPreviewBuilds.set(key, { dataUrl: obj.dataUrl, cancel });
}

function buildPreviewCanvas(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  maskObject: SceneObject | null,
): HTMLCanvasElement | null {
  const bitmap = buildProcessedRasterBitmap(obj, layer, device, { maskObject, maxEdge: 2048 });
  if (bitmap.kind === 'too-large') return null;
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const octx = canvas.getContext('2d');
  if (octx === null) return null;
  octx.putImageData(new ImageData(bitmap.rgba, bitmap.width, bitmap.height), 0, 0);
  return canvas;
}

function scheduleRasterPreviewBuild(work: () => void): () => void {
  const id = window.setTimeout(work, 0);
  return () => window.clearTimeout(id);
}

function imageMaskObjectFor(project: Project, obj: RasterImage): SceneObject | null {
  if (obj.imageMaskId === undefined) return null;
  return project.scene.objects.find((candidate) => candidate.id === obj.imageMaskId) ?? null;
}

function maskCacheKey(maskObject: SceneObject | null): string {
  if (maskObject === null) return 'mask:none';
  return JSON.stringify({
    id: maskObject.id,
    bounds: maskObject.bounds,
    transform: maskObject.transform,
    paths:
      maskObject.kind === 'raster-image' || maskObject.kind === 'relief'
        ? []
        : maskObject.paths.map((path) => ({ color: path.color, polylines: path.polylines })),
  });
}

function adjustmentKey(obj: RasterImage): string {
  return `${obj.brightness ?? 0}:${obj.contrast ?? 0}:${obj.gamma ?? 1}`;
}

function liveRasterPreviewDataUrls(project: Project): Set<string> {
  const imageLayerColors = new Set(
    project.scene.layers
      .flatMap((layer) => outputOperationLayers(layer))
      .filter((layer) => layer.mode === 'image')
      .map((layer) => layer.color),
  );
  const live = new Set<string>();
  for (const obj of project.scene.objects) {
    if (obj.kind !== 'raster-image') continue;
    if (obj.role === 'trace-source') continue;
    if (imageLayerColors.has(obj.color)) live.add(obj.dataUrl);
  }
  return live;
}

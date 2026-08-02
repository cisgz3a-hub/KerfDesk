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
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { IndexedDbPagedAssetRepository } from '../import/paged-asset-indexeddb';
import { buildProcessedRasterBitmap, processedRasterDimensions } from '../raster/processed-bitmap';

// One shared reader for every preview hydration. Each repository instance
// caches its own IDBDatabase and never closes it, so letting hydration default
// to a fresh instance leaked an open connection on every preview cache miss.
const previewAssetRepository = new IndexedDbPagedAssetRepository();
import { hydratePagedRasterImage } from '../import/paged-raster-hydration';
import { drawBitmapAtTransform } from './draw-raster';
import type { ViewTransform } from './view-transform';

export type RasterPreviewBuildScheduler = (work: () => void) => () => void;

type DrawRasterPreviewOptions = {
  readonly onRasterPreviewReady?: () => void;
  readonly scheduleBuild?: RasterPreviewBuildScheduler;
};

// Preview canvases keyed on the RasterImage's identity. The key used to embed
// the whole base64 dataUrl AND lumaBase64, so every animation frame of preview
// playback rebuilt multi-megabyte strings per raster just to look a canvas up.
// The rendered bitmap depends on the raster's own pixels — intrinsic to the
// object, and an image edit replaces the object — plus the operation settings in
// previewSettingsKey, so identity and a short settings key together are a
// complete key. WeakMap, so a deleted raster's canvas is released without a
// sweep: the same GC-bounded pattern as core/job/raster-luma-decode.ts.
const previewCanvasCache = new WeakMap<RasterImage, Map<string, HTMLCanvasElement | null>>();

// In-flight builds stay enumerable: a raster that leaves the scene must have its
// paged-asset hydration aborted, and GC cannot cancel scheduled work.
const pendingPreviewBuilds = new Map<RasterImage, Map<string, () => void>>();

export function drawRasterPreview(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
  options: DrawRasterPreviewOptions = {},
): void {
  pruneRasterPreviewBuilds(livePreviewRasters(project));
  for (const layer of project.scene.layers) {
    for (const operationLayer of outputOperationLayers(layer)) {
      if (operationLayer.mode !== 'image') continue;
      for (const obj of project.scene.objects) {
        if (obj.kind !== 'raster-image' || !sceneObjectUsesOperation(obj, operationLayer)) continue;
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

/** Aborts scheduled builds for rasters that are no longer previewed. */
export function pruneRasterPreviewBuilds(liveRasters: ReadonlySet<RasterImage>): void {
  for (const [obj, builds] of pendingPreviewBuilds) {
    if (liveRasters.has(obj)) continue;
    for (const cancel of builds.values()) cancel();
    pendingPreviewBuilds.delete(obj);
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
  const key = previewSettingsKey(obj, layer, device, maskObject);
  const cached = previewCanvasCache.get(obj);
  if (cached !== undefined && cached.has(key)) return cached.get(key) ?? null;
  schedulePreviewCanvasBuild(key, obj, layer, device, maskObject, options);
  return previewCanvasCache.get(obj)?.get(key) ?? null;
}

/** Everything about the burn that the raster's own pixels do not already fix. */
function previewSettingsKey(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  maskObject: SceneObject | null,
): string {
  const { width, height } = processedRasterDimensions(obj, layer);
  return `${adjustmentKey(obj)}|${layer.negativeImage ? 'negative' : 'positive'}|${layer.passThrough ? 'pass' : 'resample'}|${layer.ditherAlgorithm}|${layer.minPower}-${layer.power}-${device.maxPowerS}|${layer.linesPerMm}|${width}x${height}|${maskCacheKey(maskObject)}`;
}

function schedulePreviewCanvasBuild(
  key: string,
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  maskObject: SceneObject | null,
  options: DrawRasterPreviewOptions,
): void {
  if (pendingPreviewBuilds.get(obj)?.has(key) === true) return;
  const scheduleBuild = options.scheduleBuild ?? scheduleRasterPreviewBuild;
  if (obj.imageAsset === undefined) {
    let completedSynchronously = false;
    const cancel = scheduleBuild(() => {
      clearPendingBuild(obj, key);
      const canvas = buildPreviewCanvas(obj, layer, device, maskObject);
      storePreviewCanvas(obj, key, canvas);
      if (canvas !== null) options.onRasterPreviewReady?.();
      completedSynchronously = true;
    });
    if (!completedSynchronously) setPendingBuild(obj, key, cancel);
    return;
  }
  let cancelled = false;
  const controller = new AbortController();
  const cancel = scheduleBuild(() => {
    void hydratePagedRasterImage(obj, previewAssetRepository, controller.signal)
      .then((hydrated) => {
        if (cancelled) return;
        const canvas = buildPreviewCanvas(hydrated, layer, device, maskObject);
        storePreviewCanvas(obj, key, canvas);
        if (canvas !== null) options.onRasterPreviewReady?.();
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error('Raster preview asset hydration failed.', error);
      })
      .finally(() => clearPendingBuild(obj, key));
  });
  setPendingBuild(obj, key, () => {
    cancelled = true;
    controller.abort();
    cancel();
  });
}

function storePreviewCanvas(obj: RasterImage, key: string, canvas: HTMLCanvasElement | null): void {
  const entries = previewCanvasCache.get(obj);
  if (entries === undefined) previewCanvasCache.set(obj, new Map([[key, canvas]]));
  else entries.set(key, canvas);
}

function setPendingBuild(obj: RasterImage, key: string, cancel: () => void): void {
  const builds = pendingPreviewBuilds.get(obj);
  if (builds === undefined) pendingPreviewBuilds.set(obj, new Map([[key, cancel]]));
  else builds.set(key, cancel);
}

function clearPendingBuild(obj: RasterImage, key: string): void {
  const builds = pendingPreviewBuilds.get(obj);
  if (builds === undefined) return;
  builds.delete(key);
  if (builds.size === 0) pendingPreviewBuilds.delete(obj);
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

function livePreviewRasters(project: Project): Set<RasterImage> {
  const imageOperations = project.scene.layers
    .flatMap((layer) => outputOperationLayers(layer))
    .filter((layer) => layer.mode === 'image');
  const live = new Set<RasterImage>();
  for (const obj of project.scene.objects) {
    if (obj.kind !== 'raster-image') continue;
    if (obj.role === 'trace-source') continue;
    if (imageOperations.some((operation) => sceneObjectUsesOperation(obj, operation))) {
      live.add(obj);
    }
  }
  return live;
}

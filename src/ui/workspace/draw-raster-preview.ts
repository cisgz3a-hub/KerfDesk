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
import {
  lookupPreviewCanvas,
  rasterContentToken,
  retainPreviewCanvases,
  sameRasterContent,
  storePreviewCanvas,
  type RasterContentToken,
} from './raster-preview-cache';
import type { ViewTransform } from './view-transform';

export type RasterPreviewBuildScheduler = (work: () => void) => () => void;

type DrawRasterPreviewOptions = {
  readonly onRasterPreviewReady?: () => void;
  readonly scheduleBuild?: RasterPreviewBuildScheduler;
};

type PendingPreviewBuild = {
  // The content the build was started for, so an Image Studio Apply under the
  // same object id cancels it instead of being mistaken for it.
  readonly content: RasterContentToken;
  readonly cancel: () => void;
};

// In-flight builds are keyed by scene-object id like the canvas cache: a moved
// raster is a new object running the same build, and cancelling it would abort
// and restart its paged-asset hydration on every frame of the drag.
const pendingPreviewBuilds = new Map<string, Map<string, PendingPreviewBuild>>();

export function drawRasterPreview(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
  options: DrawRasterPreviewOptions = {},
): void {
  const liveRasterIds = livePreviewRasterIds(project);
  retainPreviewCanvases(liveRasterIds);
  pruneRasterPreviewBuilds(liveRasterIds);
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
function pruneRasterPreviewBuilds(liveRasterIds: ReadonlySet<string>): void {
  for (const [id, builds] of pendingPreviewBuilds) {
    if (liveRasterIds.has(id)) continue;
    for (const pending of builds.values()) pending.cancel();
    pendingPreviewBuilds.delete(id);
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
  const cached = lookupPreviewCanvas(obj, key);
  if (cached.kind === 'hit') return cached.canvas;
  schedulePreviewCanvasBuild(key, obj, layer, device, maskObject, options);
  // A synchronous scheduler fills the cache before returning; an asynchronous
  // one leaves this frame without a preview and repaints when it lands.
  const built = lookupPreviewCanvas(obj, key);
  return built.kind === 'hit' ? built.canvas : null;
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
  if (isBuildInFlight(obj, key)) return;
  const scheduleBuild = options.scheduleBuild ?? scheduleRasterPreviewBuild;
  if (obj.imageAsset === undefined) {
    let ownBuild: PendingPreviewBuild | undefined;
    let completedSynchronously = false;
    const cancel = scheduleBuild(() => {
      clearPendingBuild(obj, key, ownBuild);
      const canvas = buildPreviewCanvas(obj, layer, device, maskObject);
      storePreviewCanvas(obj, key, canvas);
      if (canvas !== null) options.onRasterPreviewReady?.();
      completedSynchronously = true;
    });
    if (!completedSynchronously) ownBuild = setPendingBuild(obj, key, cancel);
    return;
  }
  let cancelled = false;
  // Assigned once the scheduler hands back its cancel handle. The promise chain
  // below only settles in a later microtask, so the entry is always registered
  // by the time the chain reads it.
  let ownBuild: PendingPreviewBuild | undefined = undefined;
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
      // Cancelling only aborts the hydration; this chain still settles. By then
      // an Image Studio Apply may have registered a replacement under the same
      // (id, key), so the entry cleared has to be this build's own.
      .finally(() => clearPendingBuild(obj, key, ownBuild));
  });
  ownBuild = setPendingBuild(obj, key, () => {
    cancelled = true;
    controller.abort();
    cancel();
  });
}

/** True when the identical build is already running for this raster's pixels. */
function isBuildInFlight(obj: RasterImage, key: string): boolean {
  const pending = pendingPreviewBuilds.get(obj.id)?.get(key);
  if (pending === undefined) return false;
  if (sameRasterContent(pending.content, obj)) return true;
  pending.cancel();
  clearPendingBuild(obj, key, pending);
  return false;
}

function setPendingBuild(obj: RasterImage, key: string, cancel: () => void): PendingPreviewBuild {
  const pending: PendingPreviewBuild = { content: rasterContentToken(obj), cancel };
  const builds = pendingPreviewBuilds.get(obj.id);
  if (builds === undefined) pendingPreviewBuilds.set(obj.id, new Map([[key, pending]]));
  else builds.set(key, pending);
  return pending;
}

// `build` is the entry this caller registered, and is the ownership token: a
// build that no longer owns (obj.id, key) has been superseded and must leave the
// replacement's entry alone, or the replacement stops being cancellable and is
// re-scheduled as a duplicate. `undefined` means the caller never registered
// one, so there is nothing of its own to clear.
function clearPendingBuild(
  obj: RasterImage,
  key: string,
  build: PendingPreviewBuild | undefined,
): void {
  const builds = pendingPreviewBuilds.get(obj.id);
  if (builds === undefined || build === undefined || builds.get(key) !== build) return;
  builds.delete(key);
  if (builds.size === 0) pendingPreviewBuilds.delete(obj.id);
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

function livePreviewRasterIds(project: Project): Set<string> {
  const imageOperations = project.scene.layers
    .flatMap((layer) => outputOperationLayers(layer))
    .filter((layer) => layer.mode === 'image');
  const live = new Set<string>();
  for (const obj of project.scene.objects) {
    if (obj.kind !== 'raster-image') continue;
    if (obj.role === 'trace-source') continue;
    if (imageOperations.some((operation) => sceneObjectUsesOperation(obj, operation))) {
      live.add(obj.id);
    }
  }
  return live;
}

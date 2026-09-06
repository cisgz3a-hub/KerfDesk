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
import { layerWithObjectOverride } from '../../core/job/compile-job-object-policy';
import {
  effectiveObjectMinPowerPercent,
  effectiveObjectPowerPercent,
} from '../../core/job/object-power-scale';
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

type RasterPreviewRequest = {
  readonly obj: RasterImage;
  readonly layer: Layer;
  readonly maskObject: SceneObject | null;
  readonly key: string;
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
  const requests = rasterPreviewRequests(project);
  const liveRasterIds = new Set(requests.map(({ obj }) => obj.id));
  retainPreviewCanvases(liveRasterIds);
  pruneRasterPreviewBuilds(requests);
  for (const request of requests) {
    drawOnePreview(ctx, request, project.device, view, options);
  }
}

/** Retain every currently bound settings key, but cancel superseded settings
 * or pixels before an older hydration can replace a current cache record. */
function pruneRasterPreviewBuilds(requests: ReadonlyArray<RasterPreviewRequest>): void {
  const active = new Map<string, Map<string, RasterImage>>();
  for (const { obj, key } of requests) {
    const keys = active.get(obj.id) ?? new Map<string, RasterImage>();
    keys.set(key, obj);
    active.set(obj.id, keys);
  }
  for (const [id, builds] of pendingPreviewBuilds) {
    for (const [key, pending] of builds) {
      const obj = active.get(id)?.get(key);
      if (obj !== undefined && sameRasterContent(pending.content, obj)) continue;
      pending.cancel();
      builds.delete(key);
    }
    if (builds.size === 0) pendingPreviewBuilds.delete(id);
  }
}

function drawOnePreview(
  ctx: CanvasRenderingContext2D,
  request: RasterPreviewRequest,
  device: DeviceProfile,
  view: ViewTransform,
  options: DrawRasterPreviewOptions,
): void {
  const { obj } = request;
  const canvas = previewCanvasFor(request, device, options);
  if (canvas === null) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  drawBitmapAtTransform(ctx, canvas, obj.bounds, obj.transform, view);
  ctx.restore();
}

function previewCanvasFor(
  request: RasterPreviewRequest,
  device: DeviceProfile,
  options: DrawRasterPreviewOptions,
): HTMLCanvasElement | null {
  const { obj, layer, maskObject, key } = request;
  const { pixelWidth, pixelHeight } = obj;
  if (pixelWidth <= 0 || pixelHeight <= 0) return null;
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
  let cancelled = false;
  if (obj.imageAsset === undefined) {
    let ownBuild: PendingPreviewBuild | undefined;
    let completedSynchronously = false;
    const cancel = scheduleBuild(() => {
      if (cancelled) return;
      clearPendingBuild(obj, key, ownBuild);
      const canvas = buildPreviewCanvas(obj, layer, device, maskObject);
      storePreviewCanvas(obj, key, canvas);
      if (canvas !== null) options.onRasterPreviewReady?.();
      completedSynchronously = true;
    });
    if (!completedSynchronously)
      ownBuild = setPendingBuild(obj, key, () => {
        cancelled = true;
        cancel();
      });
    return;
  }
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

function rasterPreviewRequests(project: Project): RasterPreviewRequest[] {
  const requests: RasterPreviewRequest[] = [];
  for (const operation of project.scene.layers.flatMap(outputOperationLayers)) {
    for (const obj of project.scene.objects) {
      if (obj.kind !== 'raster-image' || obj.role === 'trace-source') continue;
      if (!sceneObjectUsesOperation(obj, operation)) continue;
      const effective = layerWithObjectOverride(operation, obj);
      if (effective.mode !== 'image') continue;
      // Match the compiler's rounded power schedule before normalising it for
      // display, including zero object power and min/max power overrides.
      const layer = {
        ...effective,
        power: effectiveObjectPowerPercent(effective, obj),
        minPower: effectiveObjectMinPowerPercent(effective, obj),
      };
      const maskObject = imageMaskObjectFor(project, obj);
      requests.push({
        obj,
        layer,
        maskObject,
        key: previewSettingsKey(obj, layer, project.device, maskObject),
      });
    }
  }
  return requests;
}

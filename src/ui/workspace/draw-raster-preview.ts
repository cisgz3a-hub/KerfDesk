// F.2.c raster-engrave preview (ADR-028). Renders the dithered/grayscale
// burn simulation: darker pixel = more power = deeper burn.
//
// WYSIWYG by reusing the same processed-bitmap path used by image export.
// Rendered in scene space via drawBitmapAtTransform, so the machine-origin
// transform remains confined to G-code output.
//
// Only output-enabled image-mode layers render. `layer.visible` is ignored:
// preview shows what burns, not what is merely visible.

import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import { rasterBoundsInMachineCoords, type RasterMachineBounds } from '../../core/job';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import { pixelExtentForMm } from '../../core/raster';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import { IndexedDbPagedAssetRepository } from '../import/paged-asset-indexeddb';

// One shared reader for every preview hydration. Each repository instance
// caches its own IDBDatabase and never closes it, so letting hydration default
// to a fresh instance leaked an open connection on every preview cache miss.
const previewAssetRepository = new IndexedDbPagedAssetRepository();
import { hydratePagedRasterImage } from '../import/paged-raster-hydration';
import { compiledRasterPreview, displayDimensions } from './compiled-raster-preview';
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
      for (const obj of project.scene.objects) {
        if (obj.kind !== 'raster-image' || !sceneObjectUsesOperation(obj, operationLayer)) continue;
        if (obj.role === 'trace-source') continue;
        const effectiveOperation = effectiveOperationForObject(operationLayer, obj);
        if (effectiveOperation.mode !== 'image') continue;
        drawOnePreview(
          ctx,
          obj,
          effectiveOperation,
          project.device,
          view,
          project.scene.objects,
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
  sceneObjects: ReadonlyArray<SceneObject>,
  options: DrawRasterPreviewOptions,
): void {
  const canvas = previewCanvasFor(obj, layer, device, sceneObjects, options);
  if (canvas === null) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  drawMachineRasterBitmap(ctx, canvas, rasterBoundsInMachineCoords(obj, device), device, view);
  ctx.restore();
}

function previewCanvasFor(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  sceneObjects: ReadonlyArray<SceneObject>,
  options: DrawRasterPreviewOptions,
): HTMLCanvasElement | null {
  const { pixelWidth, pixelHeight } = obj;
  if (pixelWidth <= 0 || pixelHeight <= 0) return null;
  const key = previewSettingsKey(obj, layer, device, imageMaskObjectFor(sceneObjects, obj));
  const cached = lookupPreviewCanvas(obj, key);
  if (cached.kind === 'hit') return cached.canvas;
  schedulePreviewCanvasBuild(key, obj, layer, device, sceneObjects, options);
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
  const dimensions = compiledGridDimensions(obj, layer, device);
  return `${adjustmentKey(obj)}|${layer.negativeImage ? 'negative' : 'positive'}|${layer.passThrough ? 'pass' : 'resample'}|${layer.ditherAlgorithm}|${layer.minPower}-${layer.power}-${device.maxPowerS}|${layer.linesPerMm}|${dimensions.width}x${dimensions.height}|${transformCacheKey(obj, device)}|${maskCacheKey(maskObject)}`;
}

function schedulePreviewCanvasBuild(
  key: string,
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  sceneObjects: ReadonlyArray<SceneObject>,
  options: DrawRasterPreviewOptions,
): void {
  if (isBuildInFlight(obj, key)) return;
  const scheduleBuild = options.scheduleBuild ?? scheduleRasterPreviewBuild;
  if (obj.imageAsset === undefined) {
    let ownBuild: PendingPreviewBuild | undefined;
    let completedSynchronously = false;
    const cancel = scheduleBuild(() => {
      clearPendingBuild(obj, key, ownBuild);
      const canvas = buildPreviewCanvas(obj, layer, device, sceneObjects);
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
        const canvas = buildPreviewCanvas(hydrated, layer, device, sceneObjects);
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
  sceneObjects: ReadonlyArray<SceneObject>,
): HTMLCanvasElement | null {
  const compilation = compileRasterGroupsForLayer([obj], layer, device, { sceneObjects });
  const group = compilation.groups[0];
  if (group === undefined) return null;
  const bitmap = compiledRasterPreview(group, device);
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

function imageMaskObjectFor(
  sceneObjects: ReadonlyArray<SceneObject>,
  obj: RasterImage,
): SceneObject | null {
  if (obj.imageMaskId === undefined) return null;
  return sceneObjects.find((candidate) => candidate.id === obj.imageMaskId) ?? null;
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

function transformCacheKey(obj: RasterImage, device: DeviceProfile): string {
  return JSON.stringify({
    bounds: obj.bounds,
    scaleX: obj.transform.scaleX,
    scaleY: obj.transform.scaleY,
    mirrorX: obj.transform.mirrorX,
    mirrorY: obj.transform.mirrorY,
    rotationDeg: obj.transform.rotationDeg,
    origin: device.origin,
    bedWidth: device.bedWidth,
    bedHeight: device.bedHeight,
  });
}

function compiledGridDimensions(
  obj: RasterImage,
  layer: Layer,
  device: DeviceProfile,
): { readonly width: number; readonly height: number } {
  if (layer.passThrough) return { width: obj.pixelWidth, height: obj.pixelHeight };
  const bounds = rasterBoundsInMachineCoords(obj, device);
  return {
    width: pixelExtentForMm(bounds.maxX - bounds.minX, layer.linesPerMm),
    height: pixelExtentForMm(bounds.maxY - bounds.minY, layer.linesPerMm),
  };
}

function drawMachineRasterBitmap(
  ctx: CanvasRenderingContext2D,
  bitmap: CanvasImageSource,
  bounds: RasterMachineBounds,
  device: DeviceProfile,
  view: ViewTransform,
): void {
  const start = toSceneCoords({ x: bounds.minX, y: bounds.minY }, device);
  const end = toSceneCoords({ x: bounds.maxX, y: bounds.maxY }, device);
  ctx.save();
  ctx.translate(view.offsetX + start.x * view.scale, view.offsetY + start.y * view.scale);
  ctx.scale(Math.sign(end.x - start.x) * view.scale, Math.sign(end.y - start.y) * view.scale);
  ctx.drawImage(bitmap, 0, 0, Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  ctx.restore();
}

export type RasterPreviewDisplayAdvisory = {
  readonly objectCount: number;
  readonly largestSourceWidth: number;
  readonly largestSourceHeight: number;
  readonly largestDisplayWidth: number;
  readonly largestDisplayHeight: number;
};

export function rasterPreviewDisplayAdvisory(
  project: Project,
): RasterPreviewDisplayAdvisory | null {
  const facts: Array<{
    readonly sourceWidth: number;
    readonly sourceHeight: number;
    readonly displayWidth: number;
    readonly displayHeight: number;
  }> = [];
  for (const layer of project.scene.layers) {
    for (const operationLayer of outputOperationLayers(layer)) {
      for (const obj of project.scene.objects) {
        if (obj.kind !== 'raster-image' || !sceneObjectUsesOperation(obj, operationLayer)) continue;
        if (obj.role === 'trace-source') continue;
        const effectiveOperation = effectiveOperationForObject(operationLayer, obj);
        if (effectiveOperation.mode !== 'image') continue;
        const source = compiledGridDimensions(obj, effectiveOperation, project.device);
        const display = displayDimensions(source.width, source.height);
        if (source.width === display.width && source.height === display.height) continue;
        facts.push({
          sourceWidth: source.width,
          sourceHeight: source.height,
          displayWidth: display.width,
          displayHeight: display.height,
        });
      }
    }
  }
  if (facts.length === 0) return null;
  const largest = facts.reduce((current, candidate) =>
    candidate.sourceWidth * candidate.sourceHeight > current.sourceWidth * current.sourceHeight
      ? candidate
      : current,
  );
  return {
    objectCount: facts.length,
    largestSourceWidth: largest.sourceWidth,
    largestSourceHeight: largest.sourceHeight,
    largestDisplayWidth: largest.displayWidth,
    largestDisplayHeight: largest.displayHeight,
  };
}

function livePreviewRasterIds(project: Project): Set<string> {
  const live = new Set<string>();
  for (const obj of project.scene.objects) {
    if (obj.kind !== 'raster-image') continue;
    if (obj.role === 'trace-source') continue;
    if (
      project.scene.layers
        .flatMap((layer) => outputOperationLayers(layer))
        .some(
          (operation) =>
            sceneObjectUsesOperation(obj, operation) &&
            effectiveOperationForObject(operation, obj).mode === 'image',
        )
    ) {
      live.add(obj.id);
    }
  }
  return live;
}

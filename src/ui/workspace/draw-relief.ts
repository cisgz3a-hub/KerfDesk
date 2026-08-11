// drawReliefObject — grayscale heightmap preview of a relief on the canvas
// (Phase H.4, ADR-098). Light = stock top, dark = relief floor, so the
// carving reads like a depth map. The bitmap uses the same local transform as
// raster objects so rotation and both mirror channels agree with relief CAM.

import { type Heightmap } from '../../core/relief';
// Deep imports: core/relief's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type {
  HeightfieldHeightmapOptions,
  HeightfieldHeightmapResult,
} from '../../core/relief/heightfield-to-heightmap';
import { reliefObjectToHeightmap } from '../../core/relief/relief-object-to-heightmap';
import { transformedBBox } from '../../core/scene';
import type { Layer, ReliefObject, SceneObject } from '../../core/scene';
import type { HeightfieldReliefObject, ReliefHeightfield } from '../../core/scene/relief';
import {
  isCncRemovalGridSuperseded,
  prepareReliefHeightmapsOffThread,
} from './cnc-removal-grid-worker-client';
import { canvasTheme } from '../theme/canvas-theme';
import { drawBitmapAtTransform } from './draw-raster';
import type { ViewTransform } from './view-transform';

// Display sampling: enough cells to read the shape, cheap to rebuild.
const DISPLAY_CELLS_ACROSS = 256;
const TRANSIENT_RETRY_DELAY_MS = 500;
const TOP_GRAY = 232;
const FLOOR_GRAY = 64;
const PREVIEW_FAILURE_PREFIX = '[!] Relief preview failed: ';
const PREVIEW_FAILURE_FONT = '12px system-ui, sans-serif';
const PREVIEW_FAILURE_PADDING_X_PX = 6;
const PREVIEW_FAILURE_TEXT_OFFSET_Y_PX = 12;
const PREVIEW_FAILURE_TEXT_BASELINE: CanvasTextBaseline = 'middle';
const INCOMPLETE_PREVIEW_REASON = 'Relief preview worker returned an incomplete result.';
const UNAVAILABLE_PREVIEW_CANVAS_REASON = 'Relief preview canvas is unavailable.';

// Relief objects are immutable snapshots — the cache never goes stale
// (draw-raster.ts precedent for UI-side caches).
let meshBitmapCache = new WeakMap<ReliefObject, HTMLCanvasElement | null>();
let heightfieldPreviewCache = new WeakMap<ReliefHeightfield, Map<string, HeightfieldPreview>>();

type HeightfieldPreview =
  | { readonly kind: 'ready'; readonly bitmap: HTMLCanvasElement }
  | { readonly kind: 'failed'; readonly reason: string };

type PendingHeightfieldPreview = {
  readonly controller: AbortController;
  readonly items: ReadonlyArray<HeightfieldPreviewItem>;
};

type HeightfieldPreviewItem = {
  readonly source: ReliefHeightfield;
  readonly cacheKey: string;
  readonly reliefDepthMm: number;
  readonly options: HeightfieldHeightmapOptions;
};

let pendingHeightfieldPreview: PendingHeightfieldPreview | null = null;

/** Keep at most one current heightfield preview batch in the shared worker lane. */
export function scheduleReliefPreviews(
  objects: ReadonlyArray<SceneObject>,
  layerByColor: ReadonlyMap<string, Layer>,
  onReady?: () => void,
): void {
  // Submit one source at a time. Embedded base64 is cloned into the outer
  // Worker and then into the bounded broker; batching every visible relief
  // would multiply peak memory without increasing the globally bounded lanes.
  const items = uniqueMissingHeightfieldPreviews(objects, layerByColor).slice(0, 1);
  if (samePreviewItems(pendingHeightfieldPreview?.items ?? [], items)) return;
  pendingHeightfieldPreview?.controller.abort();
  pendingHeightfieldPreview = null;
  if (items.length === 0) return;

  const controller = new AbortController();
  const batch: PendingHeightfieldPreview = { controller, items };
  const work = prepareReliefHeightmapsOffThread(
    items.map((item, index) => ({
      taskId: String(index),
      source: item.source,
      options: item.options,
    })),
    controller.signal,
  );
  if (work === null) return;
  pendingHeightfieldPreview = batch;
  void work.then(
    (results) => {
      if (pendingHeightfieldPreview !== batch) return;
      pendingHeightfieldPreview = null;
      for (const [index, item] of items.entries()) {
        const result = results[index];
        setHeightfieldPreview(
          item,
          result?.taskId === String(index)
            ? previewFromHeightfieldResult(result.result, item.reliefDepthMm)
            : {
                kind: 'failed',
                reason: INCOMPLETE_PREVIEW_REASON,
              },
        );
      }
      onReady?.();
    },
    (error: unknown) => {
      if (pendingHeightfieldPreview !== batch) return;
      pendingHeightfieldPreview = null;
      if (isAbort(error) || isCncRemovalGridSuperseded(error)) onReady?.();
      else if (onReady !== undefined) window.setTimeout(onReady, TRANSIENT_RETRY_DELAY_MS);
    },
  );
}

export function drawReliefObject(
  ctx: CanvasRenderingContext2D,
  obj: ReliefObject,
  layerByColor: ReadonlyMap<string, Layer>,
  view: ViewTransform,
): void {
  if (layerByColor.get(obj.color)?.visible === false) return;
  const preview = previewFor(obj);
  if (preview?.kind === 'ready') {
    ctx.imageSmoothingEnabled = true;
    drawBitmapAtTransform(ctx, preview.bitmap, obj.bounds, obj.transform, view);
    return;
  }
  const box = transformedBBox(obj);
  ctx.save();
  const x = view.offsetX + box.minX * view.scale;
  const y = view.offsetY + box.minY * view.scale;
  const width = (box.maxX - box.minX) * view.scale;
  const height = (box.maxY - box.minY) * view.scale;
  ctx.fillStyle = canvasTheme.stockFill;
  ctx.strokeStyle = canvasTheme.stockStroke;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
  if (preview?.kind === 'failed') {
    drawHeightfieldPreviewFailure(ctx, x, y, preview.reason);
  }
}

function previewFor(obj: ReliefObject): HeightfieldPreview | null {
  if (isHeightfieldRelief(obj)) {
    const item = heightfieldPreviewItem(obj);
    return heightfieldPreviewCache.get(item.source)?.get(item.cacheKey) ?? null;
  }
  const cached = meshBitmapCache.get(obj);
  if (cached !== undefined) return cached === null ? null : { kind: 'ready', bitmap: cached };
  const built = buildMeshBitmap(obj);
  meshBitmapCache.set(obj, built);
  return built === null ? null : { kind: 'ready', bitmap: built };
}

function buildMeshBitmap(obj: ReliefObject): HTMLCanvasElement | null {
  const result = reliefObjectToHeightmap(obj, {
    targetWidthMm: obj.targetWidthMm,
    reliefDepthMm: obj.reliefDepthMm,
    mmPerCell: obj.targetWidthMm / DISPLAY_CELLS_ACROSS,
  });
  if (result.kind === 'error') return null;
  return heightmapToCanvas(result.heightmap, obj.reliefDepthMm);
}

function uniqueMissingHeightfieldPreviews(
  objects: ReadonlyArray<SceneObject>,
  layerByColor: ReadonlyMap<string, Layer>,
): ReadonlyArray<HeightfieldPreviewItem> {
  const items: HeightfieldPreviewItem[] = [];
  for (const object of objects) {
    if (!isHeightfieldRelief(object)) continue;
    if (layerByColor.get(object.color)?.visible === false) continue;
    const item = heightfieldPreviewItem(object);
    const cache = heightfieldPreviewCache.get(item.source);
    if (cache?.has(item.cacheKey) === true) continue;
    if (items.some((candidate) => samePreviewItem(candidate, item))) continue;
    items.push(item);
  }
  return items;
}

function isHeightfieldRelief(object: SceneObject): object is HeightfieldReliefObject {
  return object.kind === 'relief' && object.reliefSource.kind === 'heightfield-v1';
}

function heightfieldPreviewItem(relief: HeightfieldReliefObject): HeightfieldPreviewItem {
  const heightMm = relief.reliefSource.physicalHeightMm;
  const mmPerCell = Math.max(relief.targetWidthMm, heightMm) / DISPLAY_CELLS_ACROSS;
  const options = {
    targetWidthMm: relief.targetWidthMm,
    reliefDepthMm: relief.reliefDepthMm,
    mmPerCell,
  };
  return {
    source: relief.reliefSource,
    cacheKey: `${relief.targetWidthMm}:${relief.reliefDepthMm}:${mmPerCell}`,
    reliefDepthMm: relief.reliefDepthMm,
    options,
  };
}

function samePreviewItems(
  left: ReadonlyArray<HeightfieldPreviewItem>,
  right: ReadonlyArray<HeightfieldPreviewItem>,
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const candidate = right[index];
      return candidate !== undefined && samePreviewItem(item, candidate);
    })
  );
}

function samePreviewItem(left: HeightfieldPreviewItem, right: HeightfieldPreviewItem): boolean {
  return left.source === right.source && left.cacheKey === right.cacheKey;
}

function setHeightfieldPreview(item: HeightfieldPreviewItem, preview: HeightfieldPreview): void {
  let cache = heightfieldPreviewCache.get(item.source);
  if (cache === undefined) {
    cache = new Map();
    heightfieldPreviewCache.set(item.source, cache);
  }
  cache.set(item.cacheKey, preview);
}

function previewFromHeightfieldResult(
  result: HeightfieldHeightmapResult,
  reliefDepthMm: number,
): HeightfieldPreview {
  if (result.kind === 'error') return { kind: 'failed', reason: result.reason };
  const bitmap = heightmapToCanvas(result.heightmap, reliefDepthMm);
  return bitmap === null
    ? { kind: 'failed', reason: UNAVAILABLE_PREVIEW_CANVAS_REASON }
    : { kind: 'ready', bitmap };
}

function drawHeightfieldPreviewFailure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  reason: string,
): void {
  const message = `${PREVIEW_FAILURE_PREFIX}${reason}`;
  ctx.save();
  ctx.font = PREVIEW_FAILURE_FONT;
  ctx.fillStyle = canvasTheme.outOfBounds;
  ctx.textBaseline = PREVIEW_FAILURE_TEXT_BASELINE;
  ctx.fillText(message, x + PREVIEW_FAILURE_PADDING_X_PX, y + PREVIEW_FAILURE_TEXT_OFFSET_Y_PX);
  ctx.restore();
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Reset preview cache and cancellation state between isolated tests. */
export function resetReliefPreviewCachesForTests(): void {
  pendingHeightfieldPreview?.controller.abort();
  pendingHeightfieldPreview = null;
  meshBitmapCache = new WeakMap();
  heightfieldPreviewCache = new WeakMap();
}

function heightmapToCanvas(map: Heightmap, reliefDepthMm: number): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = map.widthCells;
  canvas.height = map.heightCells;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const image = ctx.createImageData(map.widthCells, map.heightCells);
  const px = image.data;
  const depthRange = Math.max(1e-9, reliefDepthMm);
  for (let i = 0; i < map.depth.length; i += 1) {
    const t = Math.min(1, Math.max(0, -(map.depth[i] ?? 0) / depthRange)); // 0 top → 1 floor
    const gray = Math.round(TOP_GRAY + (FLOOR_GRAY - TOP_GRAY) * t);
    const o = i * 4;
    px[o] = gray;
    px[o + 1] = gray;
    px[o + 2] = gray;
    px[o + 3] = map.inclusion?.[i] === 0 ? 0 : 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

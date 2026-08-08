// drawReliefObject — grayscale heightmap preview of a relief on the canvas
// (Phase H.4, ADR-098). Light = stock top, dark = relief floor, so the
// carving reads like a depth map. Rendered at the object's transformed AABB;
// rotation draws axis-aligned in v1 (noted in F-CNC7's edge states).

import { type Heightmap } from '../../core/relief';
import type {
  DepthMapHeightmapOptions,
  DepthMapHeightmapResult,
} from '../../core/relief/depth-map-to-heightmap';
import { reliefObjectToHeightmap } from '../../core/relief/relief-object-to-heightmap';
import { transformedBBox } from '../../core/scene';
import type { Layer, ReliefObject, SceneObject } from '../../core/scene';
import type { ReliefDepthMap } from '../../core/scene/relief';
import {
  isCncRemovalGridSuperseded,
  prepareReliefHeightmapsOffThread,
} from './cnc-removal-grid-worker-client';
import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from './view-transform';

type DepthMapRelief = Extract<ReliefObject, { readonly depthMap: ReliefDepthMap }>;

// Display sampling: enough cells to read the shape, cheap to rebuild.
const DISPLAY_CELLS_ACROSS = 256;
const TRANSIENT_RETRY_DELAY_MS = 500;
const TOP_GRAY = 232;
const FLOOR_GRAY = 64;

// Relief objects are immutable snapshots — the cache never goes stale
// (draw-raster.ts precedent for UI-side caches).
let meshBitmapCache = new WeakMap<ReliefObject, HTMLCanvasElement | null>();
let depthMapBitmapCache = new WeakMap<ReliefDepthMap, Map<string, HTMLCanvasElement | null>>();

type PendingDepthMapPreview = {
  readonly controller: AbortController;
  readonly items: ReadonlyArray<DepthMapPreviewItem>;
};

type DepthMapPreviewItem = {
  readonly source: ReliefDepthMap;
  readonly cacheKey: string;
  readonly reliefDepthMm: number;
  readonly options: DepthMapHeightmapOptions;
};

let pendingDepthMapPreview: PendingDepthMapPreview | null = null;

/** Keep at most one current depth-map preview batch in the shared worker lane. */
export function scheduleReliefPreviews(
  objects: ReadonlyArray<SceneObject>,
  layerByColor: ReadonlyMap<string, Layer>,
  onReady?: () => void,
): void {
  // Submit one source at a time. Embedded base64 is cloned into the outer
  // Worker and then into the bounded broker; batching every visible relief
  // would multiply peak memory without increasing the globally bounded lanes.
  const items = uniqueMissingDepthMapPreviews(objects, layerByColor).slice(0, 1);
  if (samePreviewItems(pendingDepthMapPreview?.items ?? [], items)) return;
  pendingDepthMapPreview?.controller.abort();
  pendingDepthMapPreview = null;
  if (items.length === 0) return;

  const controller = new AbortController();
  const batch: PendingDepthMapPreview = { controller, items };
  const work = prepareReliefHeightmapsOffThread(
    items.map((item, index) => ({
      taskId: String(index),
      source: item.source,
      options: item.options,
    })),
    controller.signal,
  );
  if (work === null) return;
  pendingDepthMapPreview = batch;
  void work.then(
    (results) => {
      if (pendingDepthMapPreview !== batch) return;
      pendingDepthMapPreview = null;
      for (const [index, item] of items.entries()) {
        const result = results[index];
        setDepthMapBitmap(
          item,
          result?.taskId === String(index)
            ? bitmapFromDepthMapResult(result.result, item.reliefDepthMm)
            : null,
        );
      }
      onReady?.();
    },
    (error: unknown) => {
      if (pendingDepthMapPreview !== batch) return;
      pendingDepthMapPreview = null;
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
  const bitmap = bitmapFor(obj);
  const box = transformedBBox(obj);
  ctx.save();
  const x = view.offsetX + box.minX * view.scale;
  const y = view.offsetY + box.minY * view.scale;
  const width = (box.maxX - box.minX) * view.scale;
  const height = (box.maxY - box.minY) * view.scale;
  if (bitmap === null) {
    ctx.fillStyle = canvasTheme.stockFill;
    ctx.strokeStyle = canvasTheme.stockStroke;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bitmap, x, y, width, height);
  }
  ctx.restore();
}

function bitmapFor(obj: ReliefObject): HTMLCanvasElement | null {
  if (obj.depthMap !== undefined) {
    const item = depthMapPreviewItem(obj);
    return depthMapBitmapCache.get(item.source)?.get(item.cacheKey) ?? null;
  }
  const cached = meshBitmapCache.get(obj);
  if (cached !== undefined) return cached;
  const built = buildMeshBitmap(obj);
  meshBitmapCache.set(obj, built);
  return built;
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

function uniqueMissingDepthMapPreviews(
  objects: ReadonlyArray<SceneObject>,
  layerByColor: ReadonlyMap<string, Layer>,
): ReadonlyArray<DepthMapPreviewItem> {
  const items: DepthMapPreviewItem[] = [];
  for (const object of objects) {
    if (!isDepthMapRelief(object)) continue;
    if (layerByColor.get(object.color)?.visible === false) continue;
    const item = depthMapPreviewItem(object);
    const cache = depthMapBitmapCache.get(item.source);
    if (cache?.has(item.cacheKey) === true) continue;
    if (items.some((candidate) => samePreviewItem(candidate, item))) continue;
    items.push(item);
  }
  return items;
}

function isDepthMapRelief(object: SceneObject): object is DepthMapRelief {
  return object.kind === 'relief' && object.depthMap !== undefined;
}

function depthMapPreviewItem(relief: DepthMapRelief): DepthMapPreviewItem {
  const heightMm = relief.targetWidthMm * (relief.depthMap.height / relief.depthMap.width);
  const mmPerCell = Math.max(relief.targetWidthMm, heightMm) / DISPLAY_CELLS_ACROSS;
  const options = {
    targetWidthMm: relief.targetWidthMm,
    reliefDepthMm: relief.reliefDepthMm,
    mmPerCell,
  };
  return {
    source: relief.depthMap,
    cacheKey: `${relief.targetWidthMm}:${relief.reliefDepthMm}:${mmPerCell}`,
    reliefDepthMm: relief.reliefDepthMm,
    options,
  };
}

function samePreviewItems(
  left: ReadonlyArray<DepthMapPreviewItem>,
  right: ReadonlyArray<DepthMapPreviewItem>,
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const candidate = right[index];
      return candidate !== undefined && samePreviewItem(item, candidate);
    })
  );
}

function samePreviewItem(left: DepthMapPreviewItem, right: DepthMapPreviewItem): boolean {
  return left.source === right.source && left.cacheKey === right.cacheKey;
}

function setDepthMapBitmap(item: DepthMapPreviewItem, bitmap: HTMLCanvasElement | null): void {
  let cache = depthMapBitmapCache.get(item.source);
  if (cache === undefined) {
    cache = new Map();
    depthMapBitmapCache.set(item.source, cache);
  }
  cache.set(item.cacheKey, bitmap);
}

function bitmapFromDepthMapResult(
  result: DepthMapHeightmapResult,
  reliefDepthMm: number,
): HTMLCanvasElement | null {
  return result.kind === 'ok' ? heightmapToCanvas(result.heightmap, reliefDepthMm) : null;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Reset preview cache and cancellation state between isolated tests. */
export function resetReliefPreviewCachesForTests(): void {
  pendingDepthMapPreview?.controller.abort();
  pendingDepthMapPreview = null;
  meshBitmapCache = new WeakMap();
  depthMapBitmapCache = new WeakMap();
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
    px[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

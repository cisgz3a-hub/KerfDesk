// drawReliefObject — grayscale heightmap preview of a relief on the canvas
// (Phase H.4, ADR-094). Light = stock top, dark = relief floor, so the
// carving reads like a depth map. Rendered at the object's transformed AABB;
// rotation draws axis-aligned in v1 (noted in F-CNC7's edge states).

import { meshToHeightmap, type Heightmap } from '../../core/relief';
import { transformedBBox } from '../../core/scene';
import type { Layer, ReliefObject } from '../../core/scene';
import type { ViewTransform } from './view-transform';

// Display sampling: enough cells to read the shape, cheap to rebuild.
const DISPLAY_CELLS_ACROSS = 256;
const TOP_GRAY = 232;
const FLOOR_GRAY = 64;

// Relief objects are immutable snapshots — the cache never goes stale
// (draw-raster.ts precedent for UI-side caches).
const bitmapCache = new WeakMap<ReliefObject, HTMLCanvasElement | null>();

export function drawReliefObject(
  ctx: CanvasRenderingContext2D,
  obj: ReliefObject,
  layerByColor: ReadonlyMap<string, Layer>,
  view: ViewTransform,
): void {
  if (layerByColor.get(obj.color)?.visible === false) return;
  const bitmap = bitmapFor(obj);
  if (bitmap === null) return;
  const box = transformedBBox(obj);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    bitmap,
    view.offsetX + box.minX * view.scale,
    view.offsetY + box.minY * view.scale,
    (box.maxX - box.minX) * view.scale,
    (box.maxY - box.minY) * view.scale,
  );
  ctx.restore();
}

function bitmapFor(obj: ReliefObject): HTMLCanvasElement | null {
  const cached = bitmapCache.get(obj);
  if (cached !== undefined) return cached;
  const built = buildBitmap(obj);
  bitmapCache.set(obj, built);
  return built;
}

function buildBitmap(obj: ReliefObject): HTMLCanvasElement | null {
  const result = meshToHeightmap(
    { positions: Float32Array.from(obj.meshPositions) },
    {
      targetWidthMm: obj.targetWidthMm,
      reliefDepthMm: obj.reliefDepthMm,
      mmPerCell: obj.targetWidthMm / DISPLAY_CELLS_ACROSS,
      emptyCells: obj.emptyCells,
    },
  );
  if (result.kind === 'error') return null;
  return heightmapToCanvas(result.heightmap, obj.reliefDepthMm);
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

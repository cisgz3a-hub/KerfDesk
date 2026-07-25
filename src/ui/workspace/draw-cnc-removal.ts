// drawCncRemoval — depth-shaded material-removal overlay for the CNC preview
// (Phase H.2, ADR-098). The removal grid (computed in SCENE space by
// use-cnc-removal-grid) rasterizes to an offscreen canvas — transparent where
// untouched, wood-toned light→dark with depth — and blits over the faint
// artwork so the operator sees exactly what the job will carve, scrubbed
// live by the playback slider.

import type { ChiploadMaterial } from '../../core/cnc';
import type { RemovalGrid } from '../../core/sim';
import { materialAppearance } from '../theme/material-appearance';
import type { ViewTransform } from './view-transform';

const SHALLOW_ALPHA = 110;
const DEEP_ALPHA = 235;

// One offscreen bitmap per grid instance — grids are immutable snapshots, so
// a WeakMap cache never goes stale (draw-raster.ts precedent for UI caches).
// The material key is cached ALONGSIDE the bitmap rather than ignored: the
// grid is unchanged when the operator switches stock, so a grid-only key would
// keep serving oak pixels for an acrylic job.
type CachedBitmap = {
  readonly materialKey: ChiploadMaterial | undefined;
  readonly bitmap: HTMLCanvasElement | null;
};
const bitmapCache = new WeakMap<RemovalGrid, CachedBitmap>();

export function drawCncRemoval(
  ctx: CanvasRenderingContext2D,
  grid: RemovalGrid,
  view: ViewTransform,
  materialKey: ChiploadMaterial | undefined,
): void {
  const bitmap = bitmapFor(grid, materialKey);
  if (bitmap === null) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    bitmap,
    view.offsetX + grid.originX * view.scale,
    view.offsetY + grid.originY * view.scale,
    grid.widthCells * grid.mmPerCell * view.scale,
    grid.heightCells * grid.mmPerCell * view.scale,
  );
  ctx.restore();
}

function bitmapFor(
  grid: RemovalGrid,
  materialKey: ChiploadMaterial | undefined,
): HTMLCanvasElement | null {
  const cached = bitmapCache.get(grid);
  if (cached !== undefined && cached.materialKey === materialKey) return cached.bitmap;
  const built = buildBitmap(grid, materialKey);
  bitmapCache.set(grid, { materialKey, bitmap: built });
  return built;
}

function buildBitmap(
  grid: RemovalGrid,
  materialKey: ChiploadMaterial | undefined,
): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = grid.widthCells;
  canvas.height = grid.heightCells;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  let deepest = 0;
  for (const cellDepth of grid.depth) {
    if (cellDepth < deepest) deepest = cellDepth;
  }
  if (deepest >= 0) return null; // nothing removed yet — draw nothing

  const { shallowRgb, deepRgb } = materialAppearance(materialKey);
  const image = ctx.createImageData(grid.widthCells, grid.heightCells);
  const px = image.data;
  for (let i = 0; i < grid.depth.length; i += 1) {
    const depth = grid.depth[i] ?? 0;
    if (depth >= 0) continue; // transparent: untouched stock
    const t = Math.min(1, depth / deepest); // 0 shallow → 1 deepest
    const o = i * 4;
    px[o] = lerpChannel(shallowRgb[0], deepRgb[0], t);
    px[o + 1] = lerpChannel(shallowRgb[1], deepRgb[1], t);
    px[o + 2] = lerpChannel(shallowRgb[2], deepRgb[2], t);
    px[o + 3] = lerpChannel(SHALLOW_ALPHA, DEEP_ALPHA, t);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function lerpChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

// Large whole Fill pools painted from a raster (ADR-683 Amendment 3,
// performance audit S2-P2-3).
//
// Painting a dense even-odd pool is a GPU cost no cache of the path removes:
// 5,000 overlapping circles (240,000 segments) took 1.3 s of raster at fit
// zoom, 3 s at twice that, and dragging one member repainted it on every step.
// So a large pool is held as two bitmaps, its fill and its outline, and:
//
// - a pool unchanged since its raster was finished is two blits;
// - a pool that differs from a finished raster of the same operation by a few
//   members (a drag) is shown from that raster: the fill bitmap composited
//   "xor" with the changed members' old and new contours, which is exactly how
//   even-odd parity changes, and the outline with the old ones erased and the
//   new ones stroked. Only the outline is approximate (other outlines lose a
//   thin strip where an old one crossed them), and only until the pool settles;
// - once the pool has stayed put for RASTER_SETTLE_MS, its exact raster is
//   painted in bands of whole pixel rows, a budgeted few a frame. Each band is
//   the full even-odd fill and outline clipped to its rows, of only the
//   contours that reach them, so the finished raster is pixel for pixel the
//   one painted at once, and no frame waits for all of it;
// - with no raster to start from, or more change than a preview can carry,
//   the raster is painted at once, as the sprite was.
//
// Geometry, hit testing and output never read a raster.

import { SPRITE_PAD_PX } from './artwork-sprite-cache';
import { fillClosedPolylinesBatched, strokePolylinesBatched } from './draw-vector-strokes';
import { bandContours, nextBand, rasterRows, type RasterRows } from './fill-pool-raster-bands';
import {
  blitLayers,
  difference,
  drawPreview,
  MAX_RASTER_PIXELS,
  MAX_RASTER_SIDE_PX,
  newCanvas,
  paintView,
  previewWork,
  resetPreviewScratchForTests,
  WORLD,
  type Diff,
  type Frame,
  type Layers,
  type RasterMember,
} from './fill-pool-raster-preview';
import type { FillPool } from './fill-pools';
import type { VectorSceneObject } from './object-display';
import type { ViewTransform } from './view-transform';

export { PREVIEW_MAX_SEGMENTS } from './fill-pool-raster-preview';

/** Quiet time after a pool's last change before its exact raster is painted. */
export const RASTER_SETTLE_MS = 150;
/** Raster work a frame, in segment-rows (one segment crossing one pixel row). */
export const FRAME_ROW_BUDGET = 60_000;
const MAX_RASTERS = 6;
// Every raster's two layers together; finished rasters not drawn this frame
// are dropped, least used first, to make room.
const TOTAL_RASTER_PIXELS = 12_000_000;

type Raster = Frame & {
  readonly key: string;
  readonly pool: FillPool;
  readonly members: ReadonlyMap<string, RasterMember>;
  readonly width: number;
  readonly height: number;
  readonly createdAt: number;
  rows: RasterRows | null;
  layers: Layers | null;
  nextRow: number;
  lastUsed: number;
  lastFrame: number;
};

let rasters: Raster[] = [];
let frameBudget = FRAME_ROW_BUDGET;
let useCounter = 0;
let rasterFrame = 0;
let redrawTimer: ReturnType<typeof setTimeout> | null = null;
let redrawDue = 0;

/** Counters for the guards: rasters painted at once, bands painted, previews composed. */
export const fillPoolRasterWork = {
  whole: 0,
  bands: 0,
  get previews(): number {
    return previewWork.previews;
  },
};

export function beginFillPoolRasterFrame(): void {
  frameBudget = FRAME_ROW_BUDGET;
  rasterFrame += 1;
}

export function resetFillPoolRastersForTests(): void {
  for (const raster of rasters) releaseLayers(raster);
  rasters = [];
  resetPreviewScratchForTests();
  if (redrawTimer !== null) clearTimeout(redrawTimer);
  redrawTimer = null;
  fillPoolRasterWork.whole = 0;
  fillPoolRasterWork.bands = 0;
}

/** Draw a large whole pool from its raster; false when it cannot have one here. */
export function drawLargeFillPool(
  ctx: CanvasRenderingContext2D,
  pool: FillPool,
  view: ViewTransform,
  requestRedraw?: () => void,
): boolean {
  if (!rastersSupported(ctx)) return false;
  const target = targetFor(pool, view);
  if (target === null) return false;
  if (!finished(target) && advance(ctx, target, view, requestRedraw)) return true;
  if (!finished(target)) return false;
  blitLayers(ctx, target.layers as NonNullable<Raster['layers']>, target, view);
  return true;
}

function targetFor(pool: FillPool, view: ViewTransform): Raster | null {
  useCounter += 1;
  let target = rasters.find(
    (raster) => raster.pool.contours === pool.contours && matches(raster, pool, view),
  );
  if (target === undefined) {
    const created = createRaster(pool, view);
    if (created === null) return null;
    target = created;
    remember(target);
  }
  markUsed(target);
  return target;
}

// Paint what this frame allows of an unfinished raster; true when a preview
// was drawn in its place. With nothing to preview from, it is painted whole.
function advance(
  ctx: CanvasRenderingContext2D,
  target: Raster,
  view: ViewTransform,
  requestRedraw: (() => void) | undefined,
): boolean {
  const base = previewBase(target);
  const quietMs = performance.now() - target.createdAt;
  if (base === null) {
    paintWhole(target);
    return false;
  }
  markUsed(base.raster);
  if (quietMs >= RASTER_SETTLE_MS) paintBands(target, frameBudget);
  if (finished(target)) return false;
  if (!drawPreview(ctx, base, target, view)) {
    paintWhole(target);
    return false;
  }
  scheduleRedraw(requestRedraw, RASTER_SETTLE_MS - quietMs);
  return true;
}

function markUsed(raster: Raster): void {
  raster.lastUsed = useCounter;
  raster.lastFrame = rasterFrame;
}

function paintWhole(target: Raster): void {
  if (paintBands(target, Number.POSITIVE_INFINITY)) fillPoolRasterWork.whole += 1;
}

function rastersSupported(ctx: CanvasRenderingContext2D): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    ctx.canvas instanceof HTMLCanvasElement &&
    typeof ctx.drawImage === 'function'
  );
}

function matches(raster: Raster, pool: FillPool, view: ViewTransform): boolean {
  return (
    raster.scale === view.scale &&
    raster.pool.color === pool.color &&
    raster.pool.widthPx === pool.widthPx
  );
}

function finished(raster: Raster): boolean {
  return raster.layers !== null && raster.nextRow >= raster.height;
}

function createRaster(pool: FillPool, view: ViewTransform): Raster | null {
  const { box } = pool;
  // Pixel (0, 0) lands on a whole screen pixel at this view, so the raster
  // blits exactly where a direct paint would, as a sprite does.
  const left = Math.round(view.offsetX + box.minX * view.scale) - SPRITE_PAD_PX;
  const top = Math.round(view.offsetY + box.minY * view.scale) - SPRITE_PAD_PX;
  const width = Math.ceil((box.maxX - box.minX) * view.scale) + 2 * SPRITE_PAD_PX + 1;
  const height = Math.ceil((box.maxY - box.minY) * view.scale) + 2 * SPRITE_PAD_PX + 1;
  if (width > MAX_RASTER_SIDE_PX || height > MAX_RASTER_SIDE_PX) return null;
  if (width * height > MAX_RASTER_PIXELS) return null;
  const members = new Map<string, RasterMember>();
  pool.geometry.regions.forEach((region, i) => {
    const object = pool.geometry.objects[i] as VectorSceneObject;
    members.set(object.id, { object, contours: region.contours });
  });
  return {
    key: pool.key,
    pool,
    members,
    worldX0: (left - view.offsetX) / view.scale,
    worldY0: (top - view.offsetY) / view.scale,
    scale: view.scale,
    width,
    height,
    createdAt: performance.now(),
    rows: null,
    layers: null,
    nextRow: 0,
    lastUsed: useCounter,
    lastFrame: rasterFrame,
  };
}

// A newer pool of one cluster replaces its unfinished one, which no frame
// will show again; the finished ones stay as bases, the least used dropped.
function remember(raster: Raster): void {
  const stale = rasters.filter(
    (other) =>
      other.key === raster.key &&
      !finished(other) &&
      [...other.members.keys()].some((id) => raster.members.has(id)),
  );
  for (const other of stale) releaseLayers(other);
  rasters = [raster, ...rasters.filter((other) => !stale.includes(other))];
  if (rasters.length <= MAX_RASTERS) return;
  const dropped = [...rasters]
    .sort((a, b) => a.lastUsed - b.lastUsed)
    .slice(0, rasters.length - MAX_RASTERS);
  for (const other of dropped) releaseLayers(other);
  rasters = rasters.filter((other) => !dropped.includes(other));
}

function makeRoom(pixels: number): boolean {
  const held = (raster: Raster): number =>
    raster.layers === null ? 0 : 2 * raster.width * raster.height;
  let total = pixels + rasters.reduce((sum, raster) => sum + held(raster), 0);
  const spare = rasters
    .filter((raster) => raster.layers !== null && raster.lastFrame !== rasterFrame)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  for (const raster of spare) {
    if (total <= TOTAL_RASTER_PIXELS) break;
    total -= held(raster);
    releaseLayers(raster);
    rasters = rasters.filter((other) => other !== raster);
  }
  return total <= TOTAL_RASTER_PIXELS;
}

function releaseLayers(raster: Raster): void {
  if (raster.layers === null) return;
  raster.layers.fill.width = 0;
  raster.layers.stroke.width = 0;
  raster.layers = null;
}

/** Paint bands of the exact raster up to this budget; false when no canvas can be made. */
function paintBands(raster: Raster, budget: number): boolean {
  if (raster.layers === null) {
    if (!makeRoom(2 * raster.width * raster.height)) return false;
    const fill = newCanvas(raster.width, raster.height);
    const stroke = newCanvas(raster.width, raster.height);
    if (fill === null || stroke === null) return false;
    raster.layers = { fill: fill.canvas, stroke: stroke.canvas };
  }
  raster.rows ??= rasterRows(raster.pool.contours, raster, raster.height, raster.pool.widthPx);
  let left = budget;
  while (raster.nextRow < raster.height && left > 0) {
    const band = nextBand(raster.rows, raster.nextRow, left);
    paintBand(raster, band.from, band.to);
    left -= band.cost;
    raster.nextRow = band.to;
  }
  if (Number.isFinite(budget)) frameBudget = Math.max(0, left);
  return true;
}

function paintBand(raster: Raster, from: number, to: number): void {
  const layers = raster.layers as NonNullable<Raster['layers']>;
  const contours =
    from === 0 && to >= raster.height
      ? raster.pool.contours
      : bandContours(raster.rows as RasterRows, raster.pool.contours, from, to);
  const view = paintView(raster);
  const whole = from === 0 && to >= raster.height;
  for (const [canvas, paint] of [
    [
      layers.fill,
      (ctx: CanvasRenderingContext2D) =>
        fillClosedPolylinesBatched(ctx, WORLD, contours, view, 'evenodd'),
    ],
    [
      layers.stroke,
      (ctx: CanvasRenderingContext2D) => strokePolylinesBatched(ctx, WORLD, contours, view),
    ],
  ] as const) {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.save();
    ctx.fillStyle = raster.pool.color;
    ctx.strokeStyle = raster.pool.color;
    ctx.lineWidth = raster.pool.widthPx;
    if (!whole) {
      ctx.beginPath();
      ctx.rect(0, from, raster.width, to - from);
      ctx.clip();
    }
    if (contours.length > 0) paint(ctx);
    ctx.restore();
  }
  fillPoolRasterWork.bands += 1;
}

// The finished raster of this operation the target differs from least, if a
// preview can carry the difference.
function previewBase(target: Raster): { readonly raster: Raster; readonly diff: Diff } | null {
  let best: { raster: Raster; diff: Diff } | null = null;
  for (const raster of rasters) {
    if (raster === target || raster.key !== target.key || !finished(raster)) continue;
    if (raster.pool.color !== target.pool.color) continue;
    const diff = difference(raster, target);
    if (diff !== null && (best === null || diff.segments < best.diff.segments))
      best = { raster, diff };
  }
  return best;
}

function scheduleRedraw(requestRedraw: (() => void) | undefined, delayMs: number): void {
  if (requestRedraw === undefined) return;
  const due = performance.now() + Math.max(0, delayMs);
  if (redrawTimer !== null && redrawDue <= due) return;
  if (redrawTimer !== null) clearTimeout(redrawTimer);
  redrawDue = due;
  redrawTimer = setTimeout(
    () => {
      redrawTimer = null;
      requestRedraw();
    },
    Math.max(0, delayMs),
  );
}

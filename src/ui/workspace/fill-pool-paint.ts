// Painting Fill pools (ADR-683; Amendment 3 for batching, part sprites and
// rasters). A pool is its even-odd fill plus an outline of every contour in
// the same colour: the outline only shows where copies cancel, which
// LightBurn draws unfilled, not gone.
//
// Small whole pools of one key that are painted one after another, with
// nothing drawn between them, are painted as one fill and one stroke (S2-P2-4:
// 2,500 plates with windows were 2,500 fills and strokes a frame). Pools of one
// key are separate clusters of one operation, so their regions never overlap
// and one even-odd fill paints exactly their union. Large pools come from a
// raster (fill-pool-raster.ts) or a sprite (artwork-sprite-cache.ts).

import { IDENTITY_TRANSFORM, type AABB, type Polyline } from '../../core/scene';
import { ONE_FILL_POOL_RUN, type FillPoolRuns } from '../../core/scene/fill-operations';
import { drawArtworkSprite, SPRITE_MIN_DISPLAY_SEGMENTS } from './artwork-sprite-cache';
import {
  clipClosedPolylines,
  fillClosedPolylinesBatched,
  strokePolylinesBatched,
} from './draw-vector-strokes';
import { drawLargeFillPool, beginFillPoolRasterFrame } from './fill-pool-raster';
import { planFillPools, type FillPool, type ResolvedVector } from './fill-pools';
import type { ObjectDisplay, VectorSceneObject } from './object-display';
import type { ViewTransform } from './view-transform';

const WORLD = { transform: IDENTITY_TRANSFORM };

export type FillPoolPainter = {
  /** Paint (or queue) the pools planned before one object. */
  readonly paint: (pools: ReadonlyArray<FillPool>) => void;
  /** Paint what is queued; call before anything else is drawn. */
  readonly flush: () => void;
};

/** One frame's pool painter; `alphaFor` dims a pool out of focus. */
export function createFillPoolPainter(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  alphaFor: (memberIds: ReadonlyArray<string>) => number | null,
  requestRedraw?: () => void,
): FillPoolPainter {
  beginFillPoolRasterFrame();
  let queued: FillPool[] = [];
  const flush = (): void => {
    if (queued.length === 1) paintAlone(ctx, queued[0] as FillPool, view, requestRedraw);
    else if (queued.length > 1) paintTogether(ctx, queued, view, requestRedraw);
    queued = [];
  };
  return {
    flush,
    paint(pools) {
      for (const pool of pools) {
        const alpha = alphaFor(pool.memberIds);
        // Off the canvas or not, a small pool stays in its run, so a pan that
        // moves rows of plates across the edge keeps the batch and its sprite.
        if (alpha === null && pool.regions === undefined && isSmall(pool)) {
          const head = queued[0];
          if (head !== undefined && (head.key !== pool.key || head.widthPx !== pool.widthPx)) {
            flush();
          }
          queued.push(pool);
          continue;
        }
        if (!onCanvas(ctx, pool, view)) continue;
        flush();
        ctx.save();
        if (alpha !== null) ctx.globalAlpha = alpha;
        drawFillPool(ctx, pool, view, requestRedraw);
        ctx.restore();
      }
    },
  };
}

function paintAlone(
  ctx: CanvasRenderingContext2D,
  pool: FillPool,
  view: ViewTransform,
  requestRedraw: (() => void) | undefined,
): void {
  ctx.save();
  drawFillPool(ctx, pool, view, requestRedraw);
  ctx.restore();
}

type Batch = {
  readonly pools: ReadonlyArray<FillPool>;
  readonly contours: ReadonlyArray<Polyline>;
  readonly segmentCount: number;
  readonly box: AABB;
};

// The same run of pools keeps the same contour array from frame to frame, so a
// dense batch keeps its sprite and a sparse one its cached fill path.
const batches = new WeakMap<FillPool, Batch>();

function batchOf(pools: ReadonlyArray<FillPool>): Batch {
  const first = pools[0] as FillPool;
  const cached = batches.get(first);
  if (
    cached !== undefined &&
    cached.pools.length === pools.length &&
    cached.pools.every((pool, i) => pool === pools[i])
  ) {
    return cached;
  }
  let segmentCount = 0;
  let { minX, minY, maxX, maxY } = first.box;
  for (const { box, segmentCount: segments } of pools) {
    segmentCount += segments;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  const batch = {
    pools: [...pools],
    contours: pools.flatMap((pool) => pool.contours),
    segmentCount,
    box: { minX, minY, maxX, maxY },
  };
  batches.set(first, batch);
  return batch;
}

// A batch as dense as an object ADR-346 sprites (a sheet of 2,500 plates and
// windows) is painted into a sprite and blitted on later frames, as that
// object would be: a pan repaints nothing.
function paintTogether(
  ctx: CanvasRenderingContext2D,
  pools: ReadonlyArray<FillPool>,
  view: ViewTransform,
  requestRedraw: (() => void) | undefined,
): void {
  const first = pools[0] as FillPool;
  const batch = batchOf(pools);
  const paint = (target: CanvasRenderingContext2D, at: ViewTransform): void => {
    target.fillStyle = first.color;
    target.strokeStyle = first.color;
    target.lineWidth = first.widthPx;
    fillClosedPolylinesBatched(target, WORLD, batch.contours, at, 'evenodd');
    strokePolylinesBatched(target, WORLD, batch.contours, at);
  };
  ctx.save();
  if (
    batch.segmentCount < SPRITE_MIN_DISPLAY_SEGMENTS ||
    !drawArtworkSprite({
      ctx,
      key: batch.contours,
      transform: IDENTITY_TRANSFORM,
      view,
      styleKey: `pools|${first.color}|${first.widthPx}`,
      measure: () => batch.box,
      paint,
      requestRedraw,
    })
  ) {
    paint(ctx, view);
  }
  ctx.restore();
}

function isSmall(pool: FillPool): boolean {
  return pool.segmentCount < SPRITE_MIN_DISPLAY_SEGMENTS;
}

// A pool wholly off the canvas paints nothing (the plan includes objects off it).
function onCanvas(ctx: CanvasRenderingContext2D, pool: FillPool, view: ViewTransform): boolean {
  const canvas = ctx.canvas as Partial<HTMLCanvasElement> | undefined;
  const { width, height } = canvas ?? {};
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  const pad = pool.widthPx + 2;
  const { box } = pool;
  return (
    view.offsetX + box.maxX * view.scale >= -pad &&
    view.offsetY + box.maxY * view.scale >= -pad &&
    view.offsetX + box.minX * view.scale <= (width as number) + pad &&
    view.offsetY + box.minY * view.scale <= (height as number) + pad
  );
}

/** Draw one pool: a large one from its raster or sprite, a small one directly. */
export function drawFillPool(
  ctx: CanvasRenderingContext2D,
  pool: FillPool,
  view: ViewTransform,
  requestRedraw?: () => void,
): void {
  if (!isSmall(pool)) {
    if (pool.regions === undefined && drawLargeFillPool(ctx, pool, view, requestRedraw)) return;
    const regions = pool.regions;
    if (
      drawArtworkSprite({
        ctx,
        key: regions ?? pool.contours,
        transform: IDENTITY_TRANSFORM,
        view,
        styleKey: `pool|${pool.color}|${pool.widthPx}${regions === undefined ? '' : '|part'}`,
        measure: () => contoursBounds(regions?.flat() ?? pool.contours),
        paint: (spriteCtx, spriteView) =>
          regions === undefined
            ? paintFillPool(spriteCtx, pool, spriteView)
            : paintPoolPartMasked(spriteCtx, pool, regions, spriteView),
        requestRedraw,
      })
    ) {
      return;
    }
  }
  paintFillPool(ctx, pool, view);
}

export function paintFillPool(
  ctx: CanvasRenderingContext2D,
  pool: FillPool,
  view: ViewTransform,
): void {
  ctx.fillStyle = pool.color;
  ctx.strokeStyle = pool.color;
  ctx.lineWidth = pool.widthPx;
  if (pool.regions === undefined) {
    fillClosedPolylinesBatched(ctx, WORLD, pool.contours, view, 'evenodd');
    strokePolylinesBatched(ctx, WORLD, pool.contours, view);
    return;
  }
  ctx.save();
  clipClosedPolylines(ctx, WORLD, pool.contours, view, 'evenodd');
  for (const region of pool.regions) fillClosedPolylinesBatched(ctx, WORLD, region, view);
  ctx.restore();
  for (const region of pool.regions) strokePolylinesBatched(ctx, WORLD, region, view);
}

// A large part in its own sprite: its members' regions, then kept only inside
// the pool's region by one even-odd fill composited "destination-in", which is
// what the clip does. Under a clip of a dense pool every member fill re-applied
// it (S2-P2-3: thousands of fills under a 240,000-segment clip held the GPU
// for minutes).
function paintPoolPartMasked(
  ctx: CanvasRenderingContext2D,
  pool: FillPool,
  regions: ReadonlyArray<ReadonlyArray<Polyline>>,
  view: ViewTransform,
): void {
  ctx.fillStyle = pool.color;
  ctx.strokeStyle = pool.color;
  ctx.lineWidth = pool.widthPx;
  for (const region of regions) fillClosedPolylinesBatched(ctx, WORLD, region, view);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  fillClosedPolylinesBatched(ctx, WORLD, pool.contours, view, 'evenodd');
  ctx.restore();
  for (const region of regions) strokePolylinesBatched(ctx, WORLD, region, view);
}

/** Paint resolved vectors in order with their Fill operations pooled (no sprites). */
export function paintPooledObjectDisplays(
  ctx: CanvasRenderingContext2D,
  entries: ReadonlyArray<ResolvedVector>,
  view: ViewTransform,
  paintObject: (object: VectorSceneObject, display: ObjectDisplay) => void,
  runOf: FillPoolRuns = ONE_FILL_POOL_RUN,
): void {
  const plan = planFillPools(entries, () => null, runOf);
  entries.forEach((entry, index) => {
    for (const pool of plan.poolsAt(index)) paintFillPool(ctx, pool, view);
    const display = plan.displayAt(index);
    if (display !== undefined && display.paths.length > 0) paintObject(entry.object, display);
  });
}

export function contoursBounds(contours: ReadonlyArray<Polyline>): AABB {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const contour of contours) {
    for (const point of contour.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

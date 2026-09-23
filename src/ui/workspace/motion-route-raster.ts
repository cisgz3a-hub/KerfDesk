// The live burn route's append-only raster, and how it survives a view change.
//
// The route is painted into an offscreen canvas the size of the motion layer:
// the planned route once, then each newly confirmed range appended opaque and
// composited at TRAIL_ALPHA. That raster is only exact for the view it was
// painted at. A zoom, pan or resize used to throw it away and repaint it inside
// the same layout effect — the whole plan restroked and the whole confirmed
// route re-walked and restroked — about 820 ms per wheel notch during a
// 215k-line fill, with the stroke sitting just above ADR-346's hairline cliff.
//
// ADR-346's sprite rule now applies instead. A view change blits the existing
// raster scaled and translated by the view delta as a placeholder, and keeps
// appending newly confirmed segments into it in its own view space, so the
// trail never stalls. Once the view has been quiet for ROUTE_RASTER_SETTLE_MS
// the exact raster is rebuilt off to the side in time-sliced batches, catching
// up with the confirmed route as it goes, and swapped in when it has caught up.
// Nothing about the job, the route tracking or emitted output reads this.

import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { SPRITE_SETTLE_MS } from './artwork-sprite-cache';
import {
  boundsTouch,
  confirmedRouteBatch,
  plannedRoute,
  type PlannedRoute,
  type SceneBounds,
} from './motion-route-geometry';
import {
  routeLineCap,
  routeRasterWidths,
  strokeScenePath,
  TRAIL_ALPHA,
  TRAVEL_ALPHA_FACTOR,
  TRAVEL_DASH_PX,
  TRAVEL_WIDTH_PX,
  type RoutePalette,
  type RouteRasterWidths,
} from './motion-route-style';
import type { ViewTransform } from './view-transform';

/** Quiet time after a view change before the exact raster is rebuilt. */
export const ROUTE_RASTER_SETTLE_MS = SPRITE_SETTLE_MS;
/** Main-thread time one rebuild slice may take before yielding. */
export const ROUTE_REBUILD_SLICE_MS = 8;
/**
 * Route segments walked per rebuild batch between deadline checks: about 3 ms
 * even when every one of them pays the full stroker (~3 µs, ADR-346), so a
 * slice overruns its budget by at most that.
 */
const REBUILD_BATCH_SEGMENTS = 1_024;
/** Cull margin around the canvas: half the widest stroke plus antialiasing. */
const CULL_MARGIN_PX = 4;

type RouteRaster = {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly key: string;
  readonly view: ViewTransform;
  readonly palette: RoutePalette;
  readonly widths: RouteRasterWidths;
  readonly cull: SceneBounds;
  /** Planned strokes painted so far: the travel path, then each process chunk. */
  plannedSteps: number;
  confirmedRouteMm: number;
};

type RouteRasterState = {
  readonly plan: CanvasMotionPlan;
  readonly pathConstructor: typeof Path2D;
  shown: RouteRaster;
  next: RouteRaster | null;
  pendingKey: string | null;
  pendingAt: number;
  goalRouteMm: number;
  sliceTimer: ReturnType<typeof setTimeout> | null;
  requestRedraw: (() => void) | undefined;
};

export type RouteRasterRequest = {
  /** The visible motion layer the raster is composited onto. */
  readonly ctx: CanvasRenderingContext2D;
  readonly plan: CanvasMotionPlan;
  /** Confirmed route, already clamped to the plan's length. */
  readonly confirmedRouteMm: number;
  readonly view: ViewTransform;
  readonly palette: RoutePalette;
  readonly pathConstructor: typeof Path2D;
  /** Repaints the layer; called when a settle elapses or a rebuild lands. */
  readonly requestRedraw?: (() => void) | undefined;
};

const states = new WeakMap<CanvasMotionPlan, RouteRasterState>();
let settleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Composites the route raster onto `ctx`. Returns false when rasters are not
 * available here, in which case the caller strokes the route directly.
 */
export function drawRouteRaster(request: RouteRasterRequest): boolean {
  const { ctx, view } = request;
  if (!rasterSupported(ctx)) return false;
  const key = rasterKey(ctx.canvas, view);
  const state = routeRasterState(request, key);
  if (state === null) return false;
  state.goalRouteMm = request.confirmedRouteMm;
  state.requestRedraw = request.requestRedraw;
  if (request.confirmedRouteMm < state.shown.confirmedRouteMm) rewind(state);
  appendConfirmed(state, state.shown);
  if (state.shown.key === key) {
    state.pendingKey = null;
    dropRebuild(state);
  } else if (settled(state, key)) {
    advanceRebuild(state, request, key);
  }
  blit(ctx, state.shown, view, state.shown.key === key);
  return true;
}

export function resetRouteRastersForTests(): void {
  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = null;
}

function rasterSupported(ctx: CanvasRenderingContext2D): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    ctx.canvas instanceof HTMLCanvasElement &&
    typeof ctx.drawImage === 'function'
  );
}

function rasterKey(target: HTMLCanvasElement, view: ViewTransform): string {
  return `${target.width}:${target.height}:${view.scale}:${view.offsetX}:${view.offsetY}`;
}

function routeRasterState(request: RouteRasterRequest, key: string): RouteRasterState | null {
  const existing = states.get(request.plan);
  if (existing !== undefined && existing.pathConstructor === request.pathConstructor) {
    return existing;
  }
  if (existing !== undefined) {
    dropRebuild(existing);
    discard(existing.shown);
  }
  // Nothing to stand in for the first paint of a plan, so it is exact at once:
  // at Start that is the planned route alone.
  const shown = createRaster(request, key);
  if (shown === null) return null;
  paintPlanned(shown, plannedRoute(request.plan, request.pathConstructor), null);
  const state: RouteRasterState = {
    plan: request.plan,
    pathConstructor: request.pathConstructor,
    shown,
    next: null,
    pendingKey: null,
    pendingAt: 0,
    goalRouteMm: 0,
    sliceTimer: null,
    requestRedraw: undefined,
  };
  states.set(request.plan, state);
  return state;
}

function createRaster(request: RouteRasterRequest, key: string): RouteRaster | null {
  const target = request.ctx.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const { view } = request;
  const route = plannedRoute(request.plan, request.pathConstructor);
  return {
    canvas,
    context,
    key,
    view,
    palette: request.palette,
    widths: routeRasterWidths(request.plan, view, route.segmentCount),
    cull: {
      minX: (-CULL_MARGIN_PX - view.offsetX) / view.scale,
      minY: (-CULL_MARGIN_PX - view.offsetY) / view.scale,
      maxX: (target.width + CULL_MARGIN_PX - view.offsetX) / view.scale,
      maxY: (target.height + CULL_MARGIN_PX - view.offsetY) / view.scale,
    },
    plannedSteps: 0,
    confirmedRouteMm: 0,
  };
}

// The confirmed route went backwards (a restarted pass): what the raster holds
// is ahead of the machine, so it starts over from the planned route.
function rewind(state: RouteRasterState): void {
  dropRebuild(state);
  const { shown } = state;
  shown.context.clearRect(0, 0, shown.canvas.width, shown.canvas.height);
  shown.plannedSteps = 0;
  shown.confirmedRouteMm = 0;
  paintPlanned(shown, plannedRoute(state.plan, state.pathConstructor), null);
}

/** Paints planned steps until done or past `deadline`; true when complete. */
function paintPlanned(raster: RouteRaster, route: PlannedRoute, deadline: number | null): boolean {
  const steps = route.process.length + 1;
  const { planned } = raster.palette;
  const widthPx = raster.widths.plannedPx;
  const lineCap = routeLineCap(widthPx);
  while (raster.plannedSteps < steps) {
    const index = raster.plannedSteps;
    raster.plannedSteps += 1;
    if (index === 0) {
      // Planned rapids under the cuts, far fainter (see TRAVEL_ALPHA_FACTOR).
      strokeScenePath(raster.context, route.travel, raster.view, {
        color: planned,
        widthPx,
        alpha: TRAVEL_ALPHA_FACTOR,
        lineCap,
      });
    } else {
      const chunk = route.process[index - 1];
      if (chunk !== undefined && boundsTouch(chunk.bounds, raster.cull)) {
        strokeScenePath(raster.context, chunk.path, raster.view, {
          color: planned,
          widthPx,
          lineCap,
        });
      }
    }
    if (deadline !== null && performance.now() >= deadline) return raster.plannedSteps >= steps;
  }
  return true;
}

/** Appends confirmed route up to the goal, in bounded batches when a deadline is set. */
function appendConfirmed(
  state: RouteRasterState,
  raster: RouteRaster,
  deadline: number | null = null,
): boolean {
  while (raster.confirmedRouteMm < state.goalRouteMm) {
    const batch = confirmedRouteBatch(
      state.plan,
      state.pathConstructor,
      raster.confirmedRouteMm,
      state.goalRouteMm,
      raster.cull,
      deadline === null ? Number.POSITIVE_INFINITY : REBUILD_BATCH_SEGMENTS,
    );
    // Opaque into the raster: the cap is the composite in blit(), so repeated
    // overlap can never darken past one burn.
    const { scorchPx } = raster.widths;
    strokeScenePath(raster.context, batch.process, raster.view, {
      color: raster.palette.scorch,
      widthPx: scorchPx,
      lineCap: routeLineCap(scorchPx),
    });
    strokeScenePath(raster.context, batch.travel, raster.view, {
      color: raster.palette.travel,
      widthPx: TRAVEL_WIDTH_PX,
      dashPx: TRAVEL_DASH_PX,
      alpha: TRAVEL_ALPHA_FACTOR,
    });
    raster.confirmedRouteMm = batch.endRouteMm;
    if (deadline !== null && performance.now() >= deadline) break;
  }
  return raster.confirmedRouteMm >= state.goalRouteMm;
}

// A new view restarts the quiet period; the exact rebuild waits until the view
// has held for ROUTE_RASTER_SETTLE_MS, so a wheel gesture or a pan drag costs a
// blit per frame and one rebuild at the end.
function settled(state: RouteRasterState, key: string): boolean {
  const now = performance.now();
  if (state.pendingKey !== key) {
    dropRebuild(state);
    state.pendingKey = key;
    state.pendingAt = now;
  } else if (now - state.pendingAt >= ROUTE_RASTER_SETTLE_MS) {
    return true;
  }
  armSettle(state, state.pendingAt + ROUTE_RASTER_SETTLE_MS - now);
  return false;
}

function armSettle(state: RouteRasterState, delayMs: number): void {
  const redraw = state.requestRedraw;
  if (redraw === undefined) return;
  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = setTimeout(
    () => {
      settleTimer = null;
      redraw();
    },
    Math.max(0, delayMs),
  );
}

function advanceRebuild(state: RouteRasterState, request: RouteRasterRequest, key: string): void {
  if (state.next !== null && state.next.key === key) return;
  dropRebuild(state);
  state.next = createRaster(request, key);
  // The first slice runs inside this paint: a small plan lands exact at once.
  if (state.next !== null && !runRebuildSlice(state)) scheduleSlice(state);
}

/** One bounded slice of the rebuild; swaps it in and returns true when caught up. */
function runRebuildSlice(state: RouteRasterState): boolean {
  const next = state.next;
  if (next === null) return false;
  const deadline = performance.now() + ROUTE_REBUILD_SLICE_MS;
  const route = plannedRoute(state.plan, state.pathConstructor);
  if (!paintPlanned(next, route, deadline) || !appendConfirmed(state, next, deadline)) return false;
  discard(state.shown);
  state.shown = next;
  state.next = null;
  return true;
}

function scheduleSlice(state: RouteRasterState): void {
  if (state.sliceTimer !== null) return;
  state.sliceTimer = setTimeout(() => {
    state.sliceTimer = null;
    if (runRebuildSlice(state)) state.requestRedraw?.();
    else if (state.next !== null) scheduleSlice(state);
  }, 0);
}

function dropRebuild(state: RouteRasterState): void {
  if (state.sliceTimer !== null) clearTimeout(state.sliceTimer);
  state.sliceTimer = null;
  if (state.next !== null) discard(state.next);
  state.next = null;
}

function discard(raster: RouteRaster): void {
  raster.canvas.width = 0;
  raster.canvas.height = 0;
}

// The single composite that caps the trail: whatever overlapped inside the
// raster, the artwork below still reads through at 1 - TRAIL_ALPHA. A stale
// raster is scaled and translated from its own view into the current one.
function blit(
  ctx: CanvasRenderingContext2D,
  raster: RouteRaster,
  view: ViewTransform,
  exact: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = TRAIL_ALPHA;
  if (exact) {
    ctx.drawImage(raster.canvas, 0, 0);
  } else {
    const ratio = view.scale / raster.view.scale;
    ctx.drawImage(
      raster.canvas,
      view.offsetX - raster.view.offsetX * ratio,
      view.offsetY - raster.view.offsetY * ratio,
      raster.canvas.width * ratio,
      raster.canvas.height * ratio,
    );
  }
  ctx.restore();
}

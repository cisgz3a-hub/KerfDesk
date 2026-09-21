import type { ExecutablePlanPoint } from '../../core/execution-plan';
import {
  mapControllerPointToScene,
  type CanvasMotionPlan,
  type LiveCanvasRun,
} from '../state/canvas-motion-plan';
import {
  canvasPreviewMotionSequence,
  type CanvasPreviewMotion,
} from '../state/canvas-preview-motion';
import { burnWidthPx } from './draw-burn-trail';
import { visitRouteRange } from './route-range-walk';
import type { ViewTransform } from './view-transform';

export type RoutePalette = {
  /** Route not yet confirmed by the controller. */
  readonly planned: string;
  /** Settled burn behind the head. */
  readonly scorch: string;
  /** Confirmed rapid — travelled, but nothing was cut there. */
  readonly travel: string;
};

/**
 * Opacity the whole confirmed trail composites at, applied ONCE.
 *
 * The scorch is painted opaque into its raster so that overlapping burns are
 * idempotent: a raster fill whose hatch lines land under a pixel apart settles
 * at exactly this opacity instead of accumulating toward solid, which is what
 * turned a finished fill into a blank mass over the artwork.
 */
const TRAIL_ALPHA = 0.62;
const PLANNED_WIDTH_PX = 1.2;
const TRAVEL_WIDTH_PX = 1;
const TRAVEL_DASH_PX = [2, 6];
/**
 * Rapids recede hard. A raster fill returns the head once per hatch row, so at
 * working zoom the travel strokes alone outnumber the burn and — drawn at the
 * same weight — they pack into a slab that reads as solid material.
 */
const TRAVEL_ALPHA_FACTOR = 0.3;

type CachedRoutePaths = {
  readonly process: Path2D;
  readonly travel: Path2D;
  confirmedRouteMm: number;
};

type PlannedPaths = {
  readonly process: Path2D;
  readonly travel: Path2D;
};

type CachedPlannedPath = PlannedPaths & {
  readonly pathConstructor: typeof Path2D;
};

type CachedRouteRaster = {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly pathConstructor: typeof Path2D;
  readonly viewKey: string;
  confirmedRouteMm: number;
};

type StrokeStyle = {
  readonly color: string;
  readonly widthPx: number;
  readonly dashPx?: ReadonlyArray<number>;
  readonly alpha?: number;
};

const routePathCache = new WeakMap<CanvasMotionPlan, CachedRoutePaths>();
const plannedPathCache = new WeakMap<CanvasMotionPlan, CachedPlannedPath>();
const routeRasterCache = new WeakMap<CanvasMotionPlan, CachedRouteRaster>();

export function drawCanvasMotionRoute(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  run: LiveCanvasRun,
  view: ViewTransform,
  palette: RoutePalette,
): void {
  if (plan.capability === 'file-only' || plan.capability === 'unavailable') return;
  const PathCtor = typeof Path2D === 'function' ? Path2D : null;
  if (PathCtor === null) {
    drawRouteFallback(ctx, plan, run, view, palette);
    return;
  }
  if (drawRasterizedRoute(ctx, plan, run, view, palette, PathCtor)) return;
  const cached = routePaths(plan, PathCtor, run.route.confirmedRouteMm);
  strokePlanned(ctx, plannedPaths(plan, PathCtor), view, palette);
  strokeScenePath(ctx, cached.process, view, scorchStyle(palette, plan, view));
  strokeScenePath(ctx, cached.travel, view, travelStyle(palette));
}

function plannedStyle(palette: RoutePalette): StrokeStyle {
  return { color: palette.planned, widthPx: PLANNED_WIDTH_PX, alpha: TRAIL_ALPHA };
}

/**
 * A planned rapid is drawn far fainter than a planned cut. Lumping both into
 * one path at one weight made every hatch row's return leg count as heavily as
 * the cut itself, so the rapids between two fill islands packed into a slab
 * over the bed that looked like material.
 */
function strokePlanned(
  ctx: CanvasRenderingContext2D,
  paths: PlannedPaths,
  view: ViewTransform,
  palette: RoutePalette,
  alpha = TRAIL_ALPHA,
): void {
  strokeScenePath(ctx, paths.travel, view, {
    color: palette.planned,
    widthPx: PLANNED_WIDTH_PX,
    alpha: alpha * TRAVEL_ALPHA_FACTOR,
  });
  strokeScenePath(ctx, paths.process, view, {
    color: palette.planned,
    widthPx: PLANNED_WIDTH_PX,
    alpha,
  });
}

function scorchStyle(
  palette: RoutePalette,
  plan: CanvasMotionPlan,
  view: ViewTransform,
): StrokeStyle {
  return { color: palette.scorch, widthPx: burnWidthPx(plan, view), alpha: TRAIL_ALPHA };
}

function travelStyle(palette: RoutePalette): StrokeStyle {
  return {
    color: palette.travel,
    widthPx: TRAVEL_WIDTH_PX,
    dashPx: TRAVEL_DASH_PX,
    alpha: TRAIL_ALPHA * TRAVEL_ALPHA_FACTOR,
  };
}

function routePaths(
  plan: CanvasMotionPlan,
  PathCtor: typeof Path2D,
  confirmedRouteMm: number,
): CachedRoutePaths {
  let cached = routePathCache.get(plan);
  if (cached === undefined || confirmedRouteMm < cached.confirmedRouteMm) {
    cached = createRoutePaths(PathCtor);
    routePathCache.set(plan, cached);
  }
  const target = Math.max(
    cached.confirmedRouteMm,
    Math.min(confirmedRouteMm, canvasPreviewMotionSequence(plan).totalRouteMm),
  );
  appendConfirmedRange(plan, cached, cached.confirmedRouteMm, target);
  cached.confirmedRouteMm = target;
  return cached;
}

function createRoutePaths(PathCtor: typeof Path2D): CachedRoutePaths {
  return {
    process: new PathCtor(),
    travel: new PathCtor(),
    confirmedRouteMm: 0,
  };
}

function plannedPaths(plan: CanvasMotionPlan, PathCtor: typeof Path2D): PlannedPaths {
  const cached = plannedPathCache.get(plan);
  if (cached !== undefined && cached.pathConstructor === PathCtor) return cached;
  const built = { process: new PathCtor(), travel: new PathCtor() };
  for (const motion of canvasPreviewMotionSequence(plan).motions) {
    appendFullMotion(motion.intent === 'process' ? built.process : built.travel, motion, plan);
  }
  plannedPathCache.set(plan, { ...built, pathConstructor: PathCtor });
  return built;
}

function drawRasterizedRoute(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  run: LiveCanvasRun,
  view: ViewTransform,
  palette: RoutePalette,
  PathCtor: typeof Path2D,
): boolean {
  if (
    typeof document === 'undefined' ||
    typeof HTMLCanvasElement === 'undefined' ||
    !(ctx.canvas instanceof HTMLCanvasElement) ||
    typeof ctx.drawImage !== 'function'
  ) {
    return false;
  }
  const cached = routeRaster(plan, ctx.canvas, view, palette, PathCtor);
  if (cached === null) return false;
  const target = Math.max(
    0,
    Math.min(run.route.confirmedRouteMm, canvasPreviewMotionSequence(plan).totalRouteMm),
  );
  if (target < cached.confirmedRouteMm) resetRouteRaster(cached, plan, view, palette, PathCtor);
  appendConfirmedRasterRange(plan, cached, cached.confirmedRouteMm, target, view, palette);
  cached.confirmedRouteMm = target;
  // The single composite that caps the trail: whatever overlapped inside the
  // raster, the artwork below still reads through at 1 - TRAIL_ALPHA.
  ctx.save();
  ctx.globalAlpha = TRAIL_ALPHA;
  ctx.drawImage(cached.canvas, 0, 0);
  ctx.restore();
  return true;
}

function routeRaster(
  plan: CanvasMotionPlan,
  target: HTMLCanvasElement,
  view: ViewTransform,
  palette: RoutePalette,
  PathCtor: typeof Path2D,
): CachedRouteRaster | null {
  const viewKey = `${target.width}:${target.height}:${view.scale}:${view.offsetX}:${view.offsetY}`;
  const cached = routeRasterCache.get(plan);
  if (cached !== undefined && cached.viewKey === viewKey && cached.pathConstructor === PathCtor) {
    return cached;
  }
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const created: CachedRouteRaster = {
    canvas,
    context,
    pathConstructor: PathCtor,
    viewKey,
    confirmedRouteMm: 0,
  };
  resetRouteRaster(created, plan, view, palette, PathCtor);
  routeRasterCache.set(plan, created);
  return created;
}

function resetRouteRaster(
  cached: CachedRouteRaster,
  plan: CanvasMotionPlan,
  view: ViewTransform,
  palette: RoutePalette,
  PathCtor: typeof Path2D,
): void {
  cached.context.clearRect(0, 0, cached.canvas.width, cached.canvas.height);
  strokePlanned(cached.context, plannedPaths(plan, PathCtor), view, palette, 1);
  cached.confirmedRouteMm = 0;
}

function appendConfirmedRasterRange(
  plan: CanvasMotionPlan,
  cached: CachedRouteRaster,
  fromRouteMm: number,
  toRouteMm: number,
  view: ViewTransform,
  palette: RoutePalette,
): void {
  if (toRouteMm <= fromRouteMm) return;
  const process = new cached.pathConstructor();
  const travel = new cached.pathConstructor();
  appendConfirmedRange(plan, { process, travel }, fromRouteMm, toRouteMm);
  // Opaque into the raster: the cap is the composite in drawRasterizedRoute,
  // so repeated overlap can never darken past one burn.
  strokeScenePath(cached.context, process, view, {
    color: palette.scorch,
    widthPx: burnWidthPx(plan, view),
  });
  strokeScenePath(cached.context, travel, view, {
    color: palette.travel,
    widthPx: TRAVEL_WIDTH_PX,
    dashPx: TRAVEL_DASH_PX,
    alpha: TRAVEL_ALPHA_FACTOR,
  });
}

function appendFullMotion(path: Path2D, motion: CanvasPreviewMotion, plan: CanvasMotionPlan): void {
  if (isVertical(motion) || motion.pointsMm.length < 2) return;
  motion.pointsMm.forEach((point, index) => {
    const scene = mapControllerPointToScene(point, plan);
    if (index === 0) path.moveTo(scene.x, scene.y);
    else path.lineTo(scene.x, scene.y);
  });
}

function appendConfirmedRange(
  plan: CanvasMotionPlan,
  paths: Pick<CachedRoutePaths, 'process' | 'travel'>,
  fromRouteMm: number,
  toRouteMm: number,
): void {
  visitRouteRange(plan, fromRouteMm, toRouteMm, (segment) => {
    const path = segment.intent === 'process' ? paths.process : paths.travel;
    path.moveTo(segment.from.x, segment.from.y);
    path.lineTo(segment.to.x, segment.to.y);
  });
}

function strokeScenePath(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  view: ViewTransform,
  style: StrokeStyle,
): void {
  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.widthPx / view.scale;
  // Confirmed motion is emitted as independent two-point segments, so butt caps
  // leave a visible gap at every joint on a curve.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash((style.dashPx ?? []).map((value) => value / view.scale));
  ctx.stroke(path);
  ctx.restore();
}

function drawRouteFallback(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  run: LiveCanvasRun,
  view: ViewTransform,
  palette: RoutePalette,
): void {
  for (const motion of canvasPreviewMotionSequence(plan).motions) {
    const planned = plannedStyle(palette);
    drawMotion(
      ctx,
      motion,
      motion.pointsMm,
      motion.intent === 'process'
        ? planned
        : { ...planned, alpha: TRAIL_ALPHA * TRAVEL_ALPHA_FACTOR },
      view,
      plan,
    );
    if (motion.routeStartMm >= run.route.confirmedRouteMm) continue;
    drawMotion(
      ctx,
      motion,
      confirmedMotionPoints(motion, run.route.confirmedRouteMm),
      motion.intent === 'process' ? scorchStyle(palette, plan, view) : travelStyle(palette),
      view,
      plan,
    );
  }
}

function drawMotion(
  ctx: CanvasRenderingContext2D,
  motion: CanvasPreviewMotion,
  points: ReadonlyArray<ExecutablePlanPoint>,
  style: StrokeStyle,
  view: ViewTransform,
  plan: CanvasMotionPlan,
): void {
  if (isVertical(motion) || points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.widthPx;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(style.dashPx === undefined ? [] : [...style.dashPx]);
  ctx.beginPath();
  points.forEach((point, index) => {
    const scene = mapControllerPointToScene(point, plan);
    const canvas = {
      x: view.offsetX + scene.x * view.scale,
      y: view.offsetY + scene.y * view.scale,
    };
    if (index === 0) ctx.moveTo(canvas.x, canvas.y);
    else ctx.lineTo(canvas.x, canvas.y);
  });
  ctx.stroke();
  ctx.restore();
}

function confirmedMotionPoints(
  motion: CanvasPreviewMotion,
  confirmedRouteMm: number,
): ReadonlyArray<ExecutablePlanPoint> {
  if (confirmedRouteMm >= motion.routeEndMm) return motion.pointsMm;
  const targetMm = confirmedRouteMm - motion.routeStartMm;
  const points: ExecutablePlanPoint[] = [];
  let walked = 0;
  for (let index = 1; index < motion.pointsMm.length; index += 1) {
    const from = motion.pointsMm[index - 1];
    const to = motion.pointsMm[index];
    if (from === undefined || to === undefined) continue;
    if (points.length === 0) points.push(from);
    const length = distance(from, to);
    if (walked + length <= targetMm) {
      points.push(to);
      walked += length;
      continue;
    }
    const t = length <= Number.EPSILON ? 0 : (targetMm - walked) / length;
    points.push(interpolate(from, to, Math.max(0, Math.min(1, t))));
    break;
  }
  return points;
}

function isVertical(motion: CanvasPreviewMotion): boolean {
  return motion.intent === 'plunge' || motion.intent === 'retract';
}

function distance(a: ExecutablePlanPoint, b: ExecutablePlanPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function interpolate(
  a: ExecutablePlanPoint,
  b: ExecutablePlanPoint,
  t: number,
): ExecutablePlanPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

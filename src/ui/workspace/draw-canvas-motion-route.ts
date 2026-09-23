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
import { plannedRoute, type PlannedRoute } from './motion-route-geometry';
import { drawRouteRaster } from './motion-route-raster';
import {
  PLANNED_WIDTH_PX,
  scorchStyle,
  strokeScenePath,
  TRAIL_ALPHA,
  TRAVEL_ALPHA_FACTOR,
  travelStyle,
  type RoutePalette,
  type StrokeStyle,
} from './motion-route-style';
import { visitRouteRange } from './route-range-walk';
import type { ViewTransform } from './view-transform';

type CachedRoutePaths = {
  readonly process: Path2D;
  readonly travel: Path2D;
  confirmedRouteMm: number;
};

const routePathCache = new WeakMap<CanvasMotionPlan, CachedRoutePaths>();

export function drawCanvasMotionRoute(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  run: LiveCanvasRun,
  view: ViewTransform,
  palette: RoutePalette,
  requestRedraw?: () => void,
): void {
  if (plan.capability === 'file-only' || plan.capability === 'unavailable') return;
  const PathCtor = typeof Path2D === 'function' ? Path2D : null;
  if (PathCtor === null) {
    drawRouteFallback(ctx, plan, run, view, palette);
    return;
  }
  const confirmedRouteMm = Math.max(
    0,
    Math.min(run.route.confirmedRouteMm, canvasPreviewMotionSequence(plan).totalRouteMm),
  );
  if (
    drawRouteRaster({
      ctx,
      plan,
      confirmedRouteMm,
      view,
      palette,
      pathConstructor: PathCtor,
      requestRedraw,
    })
  ) {
    return;
  }
  const cached = routePaths(plan, PathCtor, run.route.confirmedRouteMm);
  strokePlanned(ctx, plannedRoute(plan, PathCtor), view, palette);
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
 *
 * Only a context without a DOM canvas behind it gets here; the raster strokes
 * the same chunks opaque, where this translucent pass blends a crossing of two
 * chunks twice.
 */
function strokePlanned(
  ctx: CanvasRenderingContext2D,
  route: PlannedRoute,
  view: ViewTransform,
  palette: RoutePalette,
): void {
  strokeScenePath(ctx, route.travel, view, {
    ...plannedStyle(palette),
    alpha: TRAIL_ALPHA * TRAVEL_ALPHA_FACTOR,
  });
  for (const chunk of route.process) {
    strokeScenePath(ctx, chunk.path, view, plannedStyle(palette));
  }
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

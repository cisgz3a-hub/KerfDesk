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
import type { ViewTransform } from './view-transform';

type CachedRoutePaths = {
  readonly planned: Path2D;
  readonly process: Path2D;
  readonly travel: Path2D;
  confirmedRouteMm: number;
};

type CachedPlannedPath = {
  readonly pathConstructor: typeof Path2D;
  readonly path: Path2D;
};

type CachedRouteRaster = {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly pathConstructor: typeof Path2D;
  readonly viewKey: string;
  confirmedRouteMm: number;
};

const routePathCache = new WeakMap<CanvasMotionPlan, CachedRoutePaths>();
const plannedPathCache = new WeakMap<CanvasMotionPlan, CachedPlannedPath>();
const routeRasterCache = new WeakMap<CanvasMotionPlan, CachedRouteRaster>();

export function drawCanvasMotionRoute(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  run: LiveCanvasRun,
  view: ViewTransform,
  plannedColor: string,
  completedColor: string,
): void {
  if (plan.capability === 'file-only' || plan.capability === 'unavailable') return;
  const PathCtor = typeof Path2D === 'function' ? Path2D : null;
  if (PathCtor === null) {
    drawRouteFallback(ctx, plan, run, view, plannedColor, completedColor);
    return;
  }
  if (drawRasterizedRoute(ctx, plan, run, view, plannedColor, completedColor, PathCtor)) return;
  const cached = routePaths(plan, PathCtor, run.route.confirmedRouteMm);
  strokeScenePath(ctx, cached.planned, view, plannedColor, 1.2, []);
  strokeScenePath(ctx, cached.process, view, completedColor, 2.4, []);
  strokeScenePath(ctx, cached.travel, view, completedColor, 1.5, [6, 4]);
}

function routePaths(
  plan: CanvasMotionPlan,
  PathCtor: typeof Path2D,
  confirmedRouteMm: number,
): CachedRoutePaths {
  let cached = routePathCache.get(plan);
  if (cached === undefined || confirmedRouteMm < cached.confirmedRouteMm) {
    cached = createRoutePaths(plan, PathCtor);
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

function createRoutePaths(plan: CanvasMotionPlan, PathCtor: typeof Path2D): CachedRoutePaths {
  return {
    planned: plannedPath(plan, PathCtor),
    process: new PathCtor(),
    travel: new PathCtor(),
    confirmedRouteMm: 0,
  };
}

function plannedPath(plan: CanvasMotionPlan, PathCtor: typeof Path2D): Path2D {
  const cached = plannedPathCache.get(plan);
  if (cached !== undefined && cached.pathConstructor === PathCtor) return cached.path;
  const path = new PathCtor();
  for (const motion of canvasPreviewMotionSequence(plan).motions) {
    appendFullMotion(path, motion, plan);
  }
  plannedPathCache.set(plan, { pathConstructor: PathCtor, path });
  return path;
}

function drawRasterizedRoute(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  run: LiveCanvasRun,
  view: ViewTransform,
  plannedColor: string,
  completedColor: string,
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
  const cached = routeRaster(plan, ctx.canvas, view, plannedColor, PathCtor);
  if (cached === null) return false;
  const target = Math.max(
    0,
    Math.min(run.route.confirmedRouteMm, canvasPreviewMotionSequence(plan).totalRouteMm),
  );
  if (target < cached.confirmedRouteMm) {
    resetRouteRaster(cached, plan, view, plannedColor, PathCtor);
  }
  appendConfirmedRasterRange(plan, cached, cached.confirmedRouteMm, target, view, completedColor);
  cached.confirmedRouteMm = target;
  ctx.drawImage(cached.canvas, 0, 0);
  return true;
}

function routeRaster(
  plan: CanvasMotionPlan,
  target: HTMLCanvasElement,
  view: ViewTransform,
  plannedColor: string,
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
  resetRouteRaster(created, plan, view, plannedColor, PathCtor);
  routeRasterCache.set(plan, created);
  return created;
}

function resetRouteRaster(
  cached: CachedRouteRaster,
  plan: CanvasMotionPlan,
  view: ViewTransform,
  plannedColor: string,
  PathCtor: typeof Path2D,
): void {
  cached.context.clearRect(0, 0, cached.canvas.width, cached.canvas.height);
  strokeScenePath(cached.context, plannedPath(plan, PathCtor), view, plannedColor, 1.2, []);
  cached.confirmedRouteMm = 0;
}

function appendConfirmedRasterRange(
  plan: CanvasMotionPlan,
  cached: CachedRouteRaster,
  fromRouteMm: number,
  toRouteMm: number,
  view: ViewTransform,
  completedColor: string,
): void {
  if (toRouteMm <= fromRouteMm) return;
  const process = new cached.pathConstructor();
  const travel = new cached.pathConstructor();
  appendConfirmedRange(plan, { process, travel }, fromRouteMm, toRouteMm);
  strokeScenePath(cached.context, process, view, completedColor, 2.4, []);
  strokeScenePath(cached.context, travel, view, completedColor, 1.5, [6, 4]);
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
  if (toRouteMm <= fromRouteMm) return;
  const motions = canvasPreviewMotionSequence(plan).motions;
  const first = firstMotionEndingAfter(motions, fromRouteMm);
  for (let motionIndex = first; motionIndex < motions.length; motionIndex += 1) {
    const motion = motions[motionIndex];
    if (motion === undefined || motion.routeStartMm >= toRouteMm) break;
    const path = motion.intent === 'process' ? paths.process : paths.travel;
    appendMotionRange(path, motion, plan, fromRouteMm, toRouteMm);
  }
}

function appendMotionRange(
  path: Path2D,
  motion: CanvasPreviewMotion,
  plan: CanvasMotionPlan,
  fromRouteMm: number,
  toRouteMm: number,
): void {
  if (isVertical(motion)) return;
  let segmentStartMm = motion.routeStartMm;
  for (let index = 1; index < motion.pointsMm.length; index += 1) {
    const from = motion.pointsMm[index - 1];
    const to = motion.pointsMm[index];
    if (from === undefined || to === undefined) continue;
    const length = distance(from, to);
    const segmentEndMm = segmentStartMm + length;
    const clippedStart = Math.max(segmentStartMm, fromRouteMm);
    const clippedEnd = Math.min(segmentEndMm, toRouteMm);
    if (length > Number.EPSILON && clippedEnd > clippedStart) {
      const start = interpolate(from, to, (clippedStart - segmentStartMm) / length);
      const end = interpolate(from, to, (clippedEnd - segmentStartMm) / length);
      const sceneStart = mapControllerPointToScene(start, plan);
      const sceneEnd = mapControllerPointToScene(end, plan);
      path.moveTo(sceneStart.x, sceneStart.y);
      path.lineTo(sceneEnd.x, sceneEnd.y);
    }
    segmentStartMm = segmentEndMm;
    if (segmentStartMm >= toRouteMm) break;
  }
}

function firstMotionEndingAfter(
  motions: ReadonlyArray<CanvasPreviewMotion>,
  routeMm: number,
): number {
  let low = 0;
  let high = motions.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const motion = motions[middle];
    if (motion !== undefined && motion.routeEndMm > routeMm) high = middle;
    else low = middle + 1;
  }
  return low;
}

function strokeScenePath(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  view: ViewTransform,
  color: string,
  widthPx: number,
  dashPx: ReadonlyArray<number>,
): void {
  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
  ctx.strokeStyle = color;
  ctx.lineWidth = widthPx / view.scale;
  ctx.setLineDash(dashPx.map((value) => value / view.scale));
  ctx.stroke(path);
  ctx.restore();
}

function drawRouteFallback(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  run: LiveCanvasRun,
  view: ViewTransform,
  plannedColor: string,
  completedColor: string,
): void {
  for (const motion of canvasPreviewMotionSequence(plan).motions) {
    drawMotion(ctx, motion, motion.pointsMm, plannedColor, false, view, plan);
    if (motion.routeStartMm >= run.route.confirmedRouteMm) continue;
    drawMotion(
      ctx,
      motion,
      confirmedMotionPoints(motion, run.route.confirmedRouteMm),
      completedColor,
      true,
      view,
      plan,
    );
  }
}

function drawMotion(
  ctx: CanvasRenderingContext2D,
  motion: CanvasPreviewMotion,
  points: ReadonlyArray<ExecutablePlanPoint>,
  color: string,
  completed: boolean,
  view: ViewTransform,
  plan: CanvasMotionPlan,
): void {
  if (isVertical(motion) || points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = completed ? (motion.intent === 'process' ? 2.4 : 1.5) : 1.2;
  ctx.setLineDash(completed && motion.intent !== 'process' ? [6, 4] : []);
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

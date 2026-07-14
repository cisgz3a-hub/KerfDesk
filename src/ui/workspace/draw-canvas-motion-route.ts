import type { MotionBlock, MotionPoint } from '../../core/job/motion-manifest';
import {
  mapControllerPointToScene,
  type CanvasMotionPlan,
  type LiveCanvasRun,
} from '../state/canvas-motion-plan';
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
    Math.min(confirmedRouteMm, plan.manifest.totalRouteMm),
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
  for (const block of plan.manifest.blocks) appendFullBlock(path, block, plan);
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
  const target = Math.max(0, Math.min(run.route.confirmedRouteMm, plan.manifest.totalRouteMm));
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

function appendFullBlock(path: Path2D, block: MotionBlock, plan: CanvasMotionPlan): void {
  if (block.kind === 'plunge' || block.points.length < 2) return;
  block.points.forEach((point, index) => {
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
  const blocks = plan.manifest.blocks;
  const first = firstBlockEndingAfter(blocks, fromRouteMm);
  for (let blockIndex = first; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (block === undefined || block.routeStartMm >= toRouteMm) break;
    const path = block.kind === 'process' ? paths.process : paths.travel;
    appendBlockRange(path, block, plan, fromRouteMm, toRouteMm);
  }
}

function appendBlockRange(
  path: Path2D,
  block: MotionBlock,
  plan: CanvasMotionPlan,
  fromRouteMm: number,
  toRouteMm: number,
): void {
  if (block.kind === 'plunge') return;
  let segmentStartMm = block.routeStartMm;
  for (let index = 1; index < block.points.length; index += 1) {
    const from = block.points[index - 1];
    const to = block.points[index];
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

function firstBlockEndingAfter(blocks: ReadonlyArray<MotionBlock>, routeMm: number): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const block = blocks[middle];
    if (block !== undefined && block.routeEndMm > routeMm) high = middle;
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
  for (const block of plan.manifest.blocks) {
    drawBlock(ctx, block, block.points, plannedColor, false, view, plan);
    if (block.routeStartMm >= run.route.confirmedRouteMm) continue;
    drawBlock(
      ctx,
      block,
      confirmedBlockPoints(block, run.route.confirmedRouteMm),
      completedColor,
      true,
      view,
      plan,
    );
  }
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  block: MotionBlock,
  points: ReadonlyArray<MotionPoint>,
  color: string,
  completed: boolean,
  view: ViewTransform,
  plan: CanvasMotionPlan,
): void {
  if (block.kind === 'plunge' || points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = completed ? (block.kind === 'process' ? 2.4 : 1.5) : 1.2;
  ctx.setLineDash(completed && block.kind !== 'process' ? [6, 4] : []);
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

function confirmedBlockPoints(
  block: MotionBlock,
  confirmedRouteMm: number,
): ReadonlyArray<MotionPoint> {
  if (confirmedRouteMm >= block.routeEndMm) return block.points;
  const targetMm = confirmedRouteMm - block.routeStartMm;
  const points: MotionPoint[] = [];
  let walked = 0;
  for (let index = 1; index < block.points.length; index += 1) {
    const from = block.points[index - 1];
    const to = block.points[index];
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

function distance(a: MotionPoint, b: MotionPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function interpolate(a: MotionPoint, b: MotionPoint, t: number): MotionPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

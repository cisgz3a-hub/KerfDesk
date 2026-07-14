import type { MotionBlock, MotionPoint } from '../../core/job/motion-manifest';
/* eslint-disable no-restricted-syntax -- controller motion is scene data drawn
 * into the always-light canvas; fixed colors keep the safety trail unambiguous. */
import type { Vec2 } from '../../core/scene';
import {
  mapControllerPointToScene,
  type CanvasMotionPlan,
  type LiveCanvasRun,
} from '../state/canvas-motion-plan';
import type { ViewTransform } from './view-transform';

export type CanvasMotionOverlay = {
  readonly plan: CanvasMotionPlan;
  readonly run: LiveCanvasRun | null;
};

const RED = '#dc2626';
const PLANNED = 'rgba(71, 85, 105, 0.28)';

export function drawCanvasMotionOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: CanvasMotionOverlay,
  view: ViewTransform,
): void {
  const { plan, run } = overlay;
  if (run !== null) drawRoute(ctx, plan, run, view);
  drawApproach(ctx, plan, run, view);
  drawFrameStart(ctx, plan, view);
  if (plan.jobStart !== null) drawMarker(ctx, plan.jobStart, 'JOB START', view);
  if (
    plan.capability === 'realtime' &&
    run?.reportedHead !== null &&
    run?.reportedHead !== undefined
  ) {
    drawHead(ctx, mapControllerPointToScene(run.reportedHead, plan), run, view);
  }
}

function drawRoute(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  run: LiveCanvasRun,
  view: ViewTransform,
): void {
  if (plan.capability === 'file-only' || plan.capability === 'unavailable') return;
  for (const block of plan.manifest.blocks) {
    drawBlock(ctx, block, block.points, PLANNED, false, view, plan);
    if (block.routeStartMm >= run.route.confirmedRouteMm) continue;
    const points = confirmedBlockPoints(block, run.route.confirmedRouteMm);
    drawBlock(ctx, block, points, RED, true, view, plan);
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
    const canvas = sceneToCanvas(mapControllerPointToScene(point, plan), view);
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

function drawApproach(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  run: LiveCanvasRun | null,
  view: ViewTransform,
): void {
  if (plan.approachFrom === null || plan.jobStart === null || run?.lifecycle === 'finished') return;
  const from = sceneToCanvas(plan.approachFrom, view);
  const to = sceneToCanvas(plan.jobStart, view);
  ctx.save();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawFrameStart(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  view: ViewTransform,
): void {
  const start = plan.framePerimeter[0];
  const next = plan.framePerimeter[1];
  if (start === undefined || next === undefined) return;
  drawMarker(ctx, start, 'FRAME START', view);
  const from = sceneToCanvas(start, view);
  const toward = sceneToCanvas(next, view);
  const angle = Math.atan2(toward.y - from.y, toward.x - from.x);
  const length = 20;
  const end = { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
  ctx.save();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle - Math.PI / 6) * 6, end.y - Math.sin(angle - Math.PI / 6) * 6);
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle + Math.PI / 6) * 6, end.y - Math.sin(angle + Math.PI / 6) * 6);
  ctx.stroke();
  ctx.restore();
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  point: Vec2,
  label: string,
  view: ViewTransform,
): void {
  const at = sceneToCanvas(point, view);
  ctx.save();
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 4, 0, Math.PI * 2);
  ctx.fill();
  drawLabel(ctx, at.x + 8, at.y - 8, label);
  ctx.restore();
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  point: Vec2,
  run: LiveCanvasRun,
  view: ViewTransform,
): void {
  const at = sceneToCanvas(point, view);
  ctx.save();
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
  ctx.fill();
  const z = run.plan.machineKind === 'cnc' ? ` • Z ${run.reportedHead?.z.toFixed(2)} mm` : '';
  drawLabel(ctx, at.x + 9, at.y + 18, `${run.controllerState ?? run.lifecycle}${z}`);
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, label: string): void {
  ctx.font = '600 11px system-ui, sans-serif';
  const width = ctx.measureText(label).width + 10;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillRect(x - 4, y - 12, width, 17);
  ctx.fillStyle = RED;
  ctx.fillText(label, x, y);
}

function sceneToCanvas(point: Vec2, view: ViewTransform): Vec2 {
  return { x: view.offsetX + point.x * view.scale, y: view.offsetY + point.y * view.scale };
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

/* eslint-disable no-restricted-syntax -- controller motion is scene data drawn
 * onto the canvas, not chrome. The safety chrome (frame/job markers, approach,
 * head ring) stays a fixed red at both canvas themes so it can never be read as
 * anything but the machine. Only the label follows the bed — a hard-white plate
 * on the dark bed read as a sticker pasted over the work, and #dc2626 text on
 * that plate fails contrast — and it stays red either way. Burn colours proper
 * live in canvasTheme.burn* (ADR-047). */
import type { Vec2 } from '../../core/scene';
import {
  mapControllerPointToScene,
  type CanvasMotionPlan,
  type LiveCanvasRun,
} from '../state/canvas-motion-plan';
import { cncPassPosition } from '../state/canvas-pass-progress';
import { canvasTheme } from '../theme/canvas-theme';
import { drawBurnGlow, drawBurnTail } from './draw-burn-trail';
import { drawCanvasMotionRoute, type RoutePalette } from './draw-canvas-motion-route';
import type { ViewTransform } from './view-transform';

export type CanvasMotionOverlay = {
  readonly plan: CanvasMotionPlan;
  readonly run: LiveCanvasRun | null;
  readonly showStartMarkers?: boolean;
};

const RED = '#dc2626';
const HEAD_CORE = '#ffffff';
const START_LABEL_TEXT_OPACITY = 0.5;
const START_LABEL_BACKGROUND_OPACITY = 0.2;

function routePalette(): RoutePalette {
  return {
    planned: canvasTheme.burnPlanned,
    scorch: canvasTheme.burnScorch,
    travel: canvasTheme.burnTravel,
  };
}

export function drawCanvasMotionOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: CanvasMotionOverlay,
  view: ViewTransform,
): void {
  const { plan, run } = overlay;
  if (run !== null) {
    drawCanvasMotionRoute(ctx, plan, run, view, routePalette());
    drawBurnTail(ctx, plan, run, view);
  }
  drawApproach(ctx, plan, run, view);
  if (overlay.showStartMarkers !== false) drawStartMarkers(ctx, plan, view);
  if (
    plan.capability === 'realtime' &&
    run?.reportedHead !== null &&
    run?.reportedHead !== undefined
  ) {
    drawHead(ctx, mapControllerPointToScene(run.reportedHead, plan), run, view);
  }
}

// Distance below which two markers are treated as the same point on screen.
const MARKER_COLLISION_PX = 26;

function drawStartMarkers(
  ctx: CanvasRenderingContext2D,
  plan: CanvasMotionPlan,
  view: ViewTransform,
): void {
  drawFrameStart(ctx, plan, view);
  if (plan.jobStart === null) return;
  // A job origin placed on the frame corner is the common case, and stacking
  // both plates at one point rendered the two labels as overlapping nonsense.
  drawMarker(ctx, plan.jobStart, 'JOB START', view, collidesWithFrameStart(plan, view) ? 1 : -1);
}

function collidesWithFrameStart(plan: CanvasMotionPlan, view: ViewTransform): boolean {
  const frameStart = plan.framePerimeter[0];
  if (frameStart === undefined || plan.jobStart === null) return false;
  const a = sceneToCanvas(frameStart, view);
  const b = sceneToCanvas(plan.jobStart, view);
  return Math.hypot(a.x - b.x, a.y - b.y) < MARKER_COLLISION_PX;
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
  labelSide: 1 | -1 = -1,
): void {
  const at = sceneToCanvas(point, view);
  ctx.save();
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 4, 0, Math.PI * 2);
  ctx.fill();
  drawLabel(
    ctx,
    at.x + 8,
    at.y + labelSide * 8,
    label,
    START_LABEL_BACKGROUND_OPACITY,
    START_LABEL_TEXT_OPACITY,
  );
  ctx.restore();
}

/**
 * The head reads as the beam: a warm glow for the heat it is putting into the
 * material, a white-hot core, and the red ring that keeps it identifiable as
 * the machine rather than as artwork.
 */
function drawHead(
  ctx: CanvasRenderingContext2D,
  point: Vec2,
  run: LiveCanvasRun,
  view: ViewTransform,
): void {
  const at = sceneToCanvas(point, view);
  drawBurnGlow(ctx, at, run);
  ctx.save();
  ctx.fillStyle = run.lifecycle === 'finished' ? RED : HEAD_CORE;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
  ctx.stroke();
  const z = run.plan.machineKind === 'cnc' ? ` • Z ${run.reportedHead?.z.toFixed(2)} mm` : '';
  drawLabel(
    ctx,
    at.x + 9,
    at.y + 18,
    `${run.controllerState ?? run.lifecycle}${z}${passLabel(run)}`,
  );
  ctx.restore();
}

// CNC depth passes retrace the same XY route, so after the first pass the
// trail stops changing — the pass ordinal is the only visible progress.
function passLabel(run: LiveCanvasRun): string {
  const spans = run.plan.cncPassSpans;
  if (spans === undefined) return '';
  const passes = cncPassPosition(spans, run.route.confirmedRouteMm);
  return passes === null ? '' : ` • Pass ${passes.current}/${passes.total}`;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  backgroundAlpha = 0.92,
  textAlpha = 1,
): void {
  ctx.font = '600 11px system-ui, sans-serif';
  const width = ctx.measureText(label).width + 12;
  ctx.save();
  ctx.globalAlpha *= backgroundAlpha;
  ctx.fillStyle = canvasTheme.motionLabelPlate;
  fillPlate(ctx, x - 5, y - 12, width, 17);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= textAlpha;
  ctx.fillStyle = canvasTheme.motionLabelInk;
  ctx.fillText(label, x, y);
  ctx.restore();
}

function fillPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (typeof ctx.roundRect !== 'function') {
    ctx.fillRect(x, y, width, height);
    return;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 4);
  ctx.fill();
}

function sceneToCanvas(point: Vec2, view: ViewTransform): Vec2 {
  return { x: view.offsetX + point.x * view.scale, y: view.offsetY + point.y * view.scale };
}

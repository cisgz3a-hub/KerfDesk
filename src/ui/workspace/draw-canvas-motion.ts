/* eslint-disable no-restricted-syntax -- controller motion is scene data drawn
 * onto the canvas. The reported head and approach stay red; the separately
 * named planned starts use the theme's distinct marker accents. */
import type { Vec2 } from '../../core/scene';
import {
  mapControllerPointToScene,
  type CanvasMotionPlan,
  type LiveCanvasRun,
} from '../state/canvas-motion-plan';
import { cncPassPosition } from '../state/canvas-pass-progress';
import { canvasTheme } from '../theme/canvas-theme';
import { burnIsActive, drawBurnGlow, drawBurnTail } from './draw-burn-trail';
import { drawCanvasMotionRoute, type RoutePalette } from './draw-canvas-motion-route';
import { drawCanvasStartMarkers } from './draw-canvas-motion-markers';
import type { MarkerBox } from './canvas-motion-marker-layout';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import type { ViewTransform } from './view-transform';

export type CanvasMotionOverlay = {
  readonly plan: CanvasMotionPlan;
  readonly run: LiveCanvasRun | null;
  readonly showStartMarkers?: boolean;
  /** False while retained starts belong to the previous idle preparation. */
  readonly planIsCurrent?: boolean;
};

const RED = '#dc2626';
const HEAD_CORE = '#ffffff';

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
  viewport?: CanvasBitmapSize,
  artwork: ReadonlyArray<MarkerBox> = [],
): void {
  const { plan, run } = overlay;
  if (run !== null) {
    drawCanvasMotionRoute(ctx, plan, run, view, routePalette());
    drawBurnTail(ctx, plan, run, view);
  }
  drawApproach(ctx, plan, run, view);
  if (overlay.showStartMarkers !== false) {
    drawCanvasStartMarkers(ctx, plan, view, overlay.planIsCurrent === false, viewport, artwork);
  }
  if (
    plan.capability === 'realtime' &&
    run?.reportedHead !== null &&
    run?.reportedHead !== undefined
  ) {
    drawHead(ctx, mapControllerPointToScene(run.reportedHead, plan), run, view);
  }
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

/**
 * The red position marker remains visible throughout the run. Only confirmed
 * active process motion gets the warm glow and white-hot core.
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
  ctx.fillStyle = burnIsActive(run) ? HEAD_CORE : RED;
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

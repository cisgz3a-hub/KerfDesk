import type { Vec2 } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { PreparedPreviewFrame, PreviewDisplayStep } from './preview-route-frame';
import type { ViewTransform } from './view-transform';

type PreviewContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Keep individual stroke calls and their order: alpha overlap and dash starts are observable. */
export function renderPreviewFrame(
  ctx: PreviewContext,
  frame: PreparedPreviewFrame,
  view: ViewTransform,
): void {
  if (frame.futureSteps.length > 0) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (const step of frame.futureSteps) drawStep(ctx, step, view);
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = 0.72;
  for (const step of frame.wholeSteps) drawStep(ctx, step, view);
  if (frame.partial !== null) drawStep(ctx, frame.partial, view);
  ctx.restore();
  if (frame.start !== null) {
    drawMarker(
      ctx,
      frame.start,
      view,
      3.5,
      canvasTheme.previewHeadStroke,
      canvasTheme.previewTravel,
    );
  }
  if (frame.end !== null) {
    drawMarker(ctx, frame.end, view, 3.5, canvasTheme.previewTravel, canvasTheme.previewHeadStroke);
  }
  if (frame.head !== null) {
    drawMarker(
      ctx,
      frame.head,
      view,
      5,
      canvasTheme.previewHeadFill,
      canvasTheme.previewHeadStroke,
    );
  }
}

function drawStep(ctx: PreviewContext, step: PreviewDisplayStep, view: ViewTransform): void {
  if (step.kind === 'travel') {
    const feed = step.motion === 'feed';
    ctx.strokeStyle = feed ? canvasTheme.previewFeedTravel : canvasTheme.previewTravel;
    ctx.lineWidth = feed ? 0.75 : 0.5;
    ctx.setLineDash(feed ? [5, 2] : [2, 3]);
    ctx.beginPath();
    ctx.moveTo(view.offsetX + step.from.x * view.scale, view.offsetY + step.from.y * view.scale);
    ctx.lineTo(view.offsetX + step.to.x * view.scale, view.offsetY + step.to.y * view.scale);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  ctx.strokeStyle = canvasTheme.previewCut;
  ctx.lineWidth = 1;
  ctx.beginPath();
  let first = true;
  for (const point of step.polyline) {
    const x = view.offsetX + point.x * view.scale;
    const y = view.offsetY + point.y * view.scale;
    if (first) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    first = false;
  }
  ctx.stroke();
}

function drawMarker(
  ctx: PreviewContext,
  point: Vec2,
  view: ViewTransform,
  radiusPx: number,
  fillStyle: string,
  strokeStyle: string,
): void {
  const cx = view.offsetX + point.x * view.scale;
  const cy = view.offsetY + point.y * view.scale;
  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

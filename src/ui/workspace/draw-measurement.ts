import { canvasTheme } from '../theme/canvas-theme';
import type { MeasureDraft } from './measure-tool';
import type { ViewTransform } from './view-transform';

export function drawMeasurement(
  ctx: CanvasRenderingContext2D,
  draft: MeasureDraft,
  view: ViewTransform,
): void {
  const start = sceneToCanvas(draft.start, view);
  const end = sceneToCanvas(draft.end, view);
  ctx.save();
  ctx.strokeStyle = canvasTheme.measureStroke;
  ctx.fillStyle = canvasTheme.measureStroke;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  drawEndpoint(ctx, start.x, start.y);
  drawEndpoint(ctx, end.x, end.y);
  ctx.restore();
}

function drawEndpoint(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
}

function sceneToCanvas(
  point: { readonly x: number; readonly y: number },
  view: ViewTransform,
): { readonly x: number; readonly y: number } {
  return {
    x: view.offsetX + point.x * view.scale,
    y: view.offsetY + point.y * view.scale,
  };
}

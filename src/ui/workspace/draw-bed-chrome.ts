import type { Project } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from './view-transform';

export function drawBed(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  ctx.fillStyle = canvasTheme.bedFill;
  ctx.fillRect(
    view.offsetX,
    view.offsetY,
    project.device.bedWidth * view.scale,
    project.device.bedHeight * view.scale,
  );
  ctx.strokeStyle = canvasTheme.bedStroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    view.offsetX,
    view.offsetY,
    project.device.bedWidth * view.scale,
    project.device.bedHeight * view.scale,
  );
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  ctx.strokeStyle = canvasTheme.grid;
  ctx.lineWidth = 0.5;
  for (let x = 10; x < project.device.bedWidth; x += 10) {
    ctx.beginPath();
    ctx.moveTo(view.offsetX + x * view.scale, view.offsetY);
    ctx.lineTo(view.offsetX + x * view.scale, view.offsetY + project.device.bedHeight * view.scale);
    ctx.stroke();
  }
  for (let y = 10; y < project.device.bedHeight; y += 10) {
    ctx.beginPath();
    ctx.moveTo(view.offsetX, view.offsetY + y * view.scale);
    ctx.lineTo(view.offsetX + project.device.bedWidth * view.scale, view.offsetY + y * view.scale);
    ctx.stroke();
  }
}

export function drawOriginMarker(ctx: CanvasRenderingContext2D, view: ViewTransform): void {
  const cx = view.offsetX;
  const cy = view.offsetY;
  const armPx = 8;
  ctx.strokeStyle = canvasTheme.origin;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - armPx, cy);
  ctx.lineTo(cx + armPx, cy);
  ctx.moveTo(cx, cy - armPx);
  ctx.lineTo(cx, cy + armPx);
  ctx.stroke();
}

import type { Project } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { DEFAULT_SNAP_GRID_MM } from './snap-settings';
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

// The canvas grid follows the snap grid spacing (LBG-F06), so a line drawn is a
// line snapped to. When lines would crowd closer than MIN_GRID_LINE_PX apart,
// only every 2nd, 5th, 10th ... line is drawn: the drawn lines stay on the snap
// grid while the canvas stays legible when zoomed out.
const MIN_GRID_LINE_PX = 8;
const GRID_STRIDES: ReadonlyArray<number> = [1, 2, 5];

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
  gridMm: number = DEFAULT_SNAP_GRID_MM,
): void {
  const step = displayGridStepMm(gridMm, view.scale);
  if (step === null) return;
  ctx.strokeStyle = canvasTheme.grid;
  ctx.lineWidth = 0.5;
  for (let i = 1; i * step < project.device.bedWidth; i += 1) {
    const x = view.offsetX + i * step * view.scale;
    ctx.beginPath();
    ctx.moveTo(x, view.offsetY);
    ctx.lineTo(x, view.offsetY + project.device.bedHeight * view.scale);
    ctx.stroke();
  }
  for (let i = 1; i * step < project.device.bedHeight; i += 1) {
    const y = view.offsetY + i * step * view.scale;
    ctx.beginPath();
    ctx.moveTo(view.offsetX, y);
    ctx.lineTo(view.offsetX + project.device.bedWidth * view.scale, y);
    ctx.stroke();
  }
}

// The drawn spacing: the snap grid times the smallest 1-2-5 stride that keeps
// lines at least MIN_GRID_LINE_PX apart. Null for an unusable spacing or scale.
export function displayGridStepMm(gridMm: number, pxPerMm: number): number | null {
  if (!(gridMm > 0) || !Number.isFinite(gridMm) || !(pxPerMm > 0)) return null;
  for (let decade = 1; decade <= 1e9; decade *= 10) {
    for (const stride of GRID_STRIDES) {
      const step = gridMm * stride * decade;
      if (step * pxPerMm >= MIN_GRID_LINE_PX) return step;
    }
  }
  return null;
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

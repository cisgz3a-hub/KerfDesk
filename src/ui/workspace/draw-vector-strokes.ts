import { canvasTheme } from '../theme/canvas-theme';
import { applyTransform, type Polyline, type SceneObject, type Vec2 } from '../../core/scene';
import type { ViewTransform } from './view-transform';

// Batched-stroke helper used by line mode and fill preview paths. Display
// simplification of enormous traces happens upstream (display-polylines.ts
// decimates vertices); this always strokes the polylines it is given.
export function strokePolylinesBatched(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  polylines: ReadonlyArray<Polyline>,
  view: ViewTransform,
): void {
  ctx.beginPath();
  for (const polyline of polylines) {
    for (let i = 0; i < polyline.points.length; i += 1) {
      const raw = polyline.points[i];
      if (raw === undefined) continue;
      const { x: cx, y: cy } = toScreenPoint(raw, obj, view);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
  }
  ctx.stroke();
}

export function fillClosedPolylinesBatched(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  polylines: ReadonlyArray<Polyline>,
  view: ViewTransform,
  fillRule: CanvasFillRule = 'evenodd',
): void {
  ctx.beginPath();
  for (const polyline of polylines) {
    if (!polyline.closed) continue;
    appendPolylinePath(ctx, obj, polyline, view);
    ctx.closePath();
  }
  ctx.fill(fillRule);
}

export function drawLargeSceneNotice(ctx: CanvasRenderingContext2D): void {
  const msg = 'Large scene - display simplified for performance';
  const x = 14;
  const y = 14;
  const padX = 8;
  const padY = 5;
  ctx.save();
  ctx.font = '12px system-ui, sans-serif';
  const w = ctx.measureText(msg).width + padX * 2;
  const h = 24;
  ctx.fillStyle = canvasTheme.noticeFill;
  ctx.strokeStyle = canvasTheme.noticeStroke;
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = canvasTheme.noticeText;
  ctx.fillText(msg, x + padX, y + h - padY - 1);
  ctx.restore();
}

function appendPolylinePath(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  polyline: Polyline,
  view: ViewTransform,
): void {
  for (let i = 0; i < polyline.points.length; i += 1) {
    const raw = polyline.points[i];
    if (raw === undefined) continue;
    const { x, y } = toScreenPoint(raw, obj, view);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function toScreenPoint(raw: Vec2, obj: SceneObject, view: ViewTransform): Vec2 {
  const p = applyTransform(raw, obj.transform);
  return { x: view.offsetX + p.x * view.scale, y: view.offsetY + p.y * view.scale };
}

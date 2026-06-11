import { canvasTheme } from '../theme/canvas-theme';
import { applyTransform, type Polyline, type SceneObject, type Vec2 } from '../../core/scene';
import type { ViewTransform } from './view-transform';

// Batched-stroke helper used by line mode and fill preview paths. When
// stride > 1, this draws every Nth segment as a visual-only simplification
// so enormous traces do not lock Canvas2D on every redraw.
export function strokePolylinesBatched(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  polylines: ReadonlyArray<Polyline>,
  view: ViewTransform,
  stride = 1,
): boolean {
  ctx.beginPath();
  if (stride > 1) {
    strokeEveryNthSegment(ctx, obj, polylines, view, stride);
    ctx.stroke();
    return true;
  }
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
  return false;
}

export function fillClosedPolylinesBatched(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  polylines: ReadonlyArray<Polyline>,
  view: ViewTransform,
): void {
  ctx.beginPath();
  for (const polyline of polylines) {
    if (!polyline.closed) continue;
    appendPolylinePath(ctx, obj, polyline, view);
    ctx.closePath();
  }
  ctx.fill('evenodd');
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

function strokeEveryNthSegment(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  polylines: ReadonlyArray<Polyline>,
  view: ViewTransform,
  stride: number,
): void {
  let firstGlobalSegment = 0;
  for (const polyline of polylines) {
    const segmentCount = Math.max(0, polyline.points.length - 1);
    const firstLocalSegment = firstSampledLocalSegment(firstGlobalSegment, stride);
    for (
      let localSegment = firstLocalSegment;
      localSegment < segmentCount;
      localSegment += stride
    ) {
      const from = polyline.points[localSegment];
      const to = polyline.points[localSegment + 1];
      if (from === undefined || to === undefined) continue;
      const a = toScreenPoint(from, obj, view);
      const b = toScreenPoint(to, obj, view);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    firstGlobalSegment += segmentCount;
  }
}

function firstSampledLocalSegment(firstGlobalSegment: number, stride: number): number {
  const remainder = firstGlobalSegment % stride;
  return remainder === 0 ? 0 : stride - remainder;
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

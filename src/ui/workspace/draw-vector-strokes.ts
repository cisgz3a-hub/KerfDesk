import { canvasTheme } from '../theme/canvas-theme';
import { applyTransform, type Polyline, type Transform, type Vec2 } from '../../core/scene';

/** Anything placed by a transform: a scene object, or world space for a pooled fill. */
export type Placed = { readonly transform: Transform };
import type { ViewTransform } from './view-transform';
import { drawCachedClosedFill } from './filled-path-cache';

// Batched-stroke helper used by line mode and fill preview paths. Display
// simplification of enormous traces happens upstream (display-polylines.ts
// decimates vertices); this always strokes the polylines it is given.
//
// A closed polyline may omit its seam vertex (Design Studio paths, DXF
// contours); compile cuts the closing edge anyway, so it is drawn here too.
// A plain lineTo back to the start, not closePath, keeps the batch as cheap
// as the fill comment below requires.
export function strokePolylinesBatched(
  ctx: CanvasRenderingContext2D,
  obj: Placed,
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
    const seam = closingPoint(polyline);
    if (seam !== null) {
      const { x, y } = toScreenPoint(seam, obj, view);
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function closingPoint(polyline: Polyline): Vec2 | null {
  if (!polyline.closed || polyline.points.length < 3) return null;
  const first = polyline.points[0];
  const last = polyline.points[polyline.points.length - 1];
  if (first === undefined || last === undefined) return null;
  return first.x === last.x && first.y === last.y ? null : first;
}

export function fillClosedPolylinesBatched(
  ctx: CanvasRenderingContext2D,
  obj: Placed,
  polylines: ReadonlyArray<Polyline>,
  view: ViewTransform,
  fillRule: CanvasFillRule = 'evenodd',
): void {
  if (drawCachedClosedFill(ctx, polylines, obj.transform, view, fillRule)) return;
  ctx.beginPath();
  for (const polyline of polylines) {
    if (!polyline.closed) continue;
    appendPolylinePath(ctx, obj, polyline, view);
  }
  // fill() implicitly closes every subpath. Closing each contour explicitly
  // makes Chrome repeatedly process the growing batch, stalling dense artwork.
  ctx.fill(fillRule);
}

/** Clip later drawing to the region these closed polylines enclose by the rule. */
export function clipClosedPolylines(
  ctx: CanvasRenderingContext2D,
  obj: Placed,
  polylines: ReadonlyArray<Polyline>,
  view: ViewTransform,
  fillRule: CanvasFillRule,
): void {
  ctx.beginPath();
  for (const polyline of polylines) {
    if (polyline.closed) appendPolylinePath(ctx, obj, polyline, view);
  }
  ctx.clip(fillRule);
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
  obj: Placed,
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

function toScreenPoint(raw: Vec2, obj: Placed, view: ViewTransform): Vec2 {
  const p = applyTransform(raw, obj.transform);
  return { x: view.offsetX + p.x * view.scale, y: view.offsetY + p.y * view.scale };
}

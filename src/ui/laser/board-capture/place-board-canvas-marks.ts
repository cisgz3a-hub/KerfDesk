// place-board-canvas-marks — what the Place Board page paints over its canvas
// (ADR-636): the points captured so far, the outline they make, the live head
// or pointer crosshair, and the board's check points. Everything is given in
// scene millimetres and drawn in screen pixels, so marks stay the same size at
// any zoom.

import type { Vec2 } from '../../../core/scene';
import { canvasTheme } from '../../theme/canvas-theme';
import type { ViewTransform } from '../../workspace/view-transform';

export type PlaceBoardOutlineStyle = 'points' | 'path' | 'closed' | 'box';

export type PlaceBoardCanvasMarks = {
  /** The captured points, numbered in capture order. */
  readonly points: ReadonlyArray<Vec2>;
  /** The outline's corner order when it differs from the capture order: a
   * crossed custom-shape capture is joined round the board instead. */
  readonly outlinePoints?: ReadonlyArray<Vec2>;
  readonly outline: PlaceBoardOutlineStyle;
  /** Where the head (or the positioning light) is now. */
  readonly sight: { readonly point: Vec2; readonly pointer: boolean } | null;
  readonly checks: ReadonlyArray<{ readonly point: Vec2; readonly active: boolean }>;
};

const POINT_RADIUS_PX = 5;
const SIGHT_ARM_PX = 14;

export function paintPlaceBoardMarks(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  marks: PlaceBoardCanvasMarks,
): void {
  const toScreen = (p: Vec2): Vec2 => ({
    x: view.offsetX + p.x * view.scale,
    y: view.offsetY + p.y * view.scale,
  });
  ctx.save();
  paintOutline(ctx, (marks.outlinePoints ?? marks.points).map(toScreen), marks.outline);
  marks.points.forEach((point, index) => paintPoint(ctx, toScreen(point), index + 1));
  for (const check of marks.checks) paintCheck(ctx, toScreen(check.point), check.active);
  if (marks.sight !== null) paintSight(ctx, toScreen(marks.sight.point), marks.sight.pointer);
  ctx.restore();
}

function paintOutline(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<Vec2>,
  style: PlaceBoardOutlineStyle,
): void {
  if (style === 'points' || points.length < 2) return;
  ctx.beginPath();
  if (style === 'box') {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    ctx.rect(minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY);
  } else {
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (style === 'closed' && points.length >= 3) ctx.closePath();
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = canvasTheme.selection;
  ctx.setLineDash(style === 'path' ? [6, 4] : []);
  if (style !== 'path') {
    ctx.fillStyle = canvasTheme.selectionMarqueeFill;
    ctx.fill();
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintPoint(ctx: CanvasRenderingContext2D, at: Vec2, label: number): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, POINT_RADIUS_PX, 0, Math.PI * 2);
  ctx.fillStyle = canvasTheme.selection;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = canvasTheme.selectionHandleFill;
  ctx.stroke();
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeText(String(label), at.x + 7, at.y - 5);
  ctx.fillStyle = canvasTheme.selection;
  ctx.fillText(String(label), at.x + 7, at.y - 5);
}

function paintCheck(ctx: CanvasRenderingContext2D, at: Vec2, active: boolean): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, active ? 8 : 6, 0, Math.PI * 2);
  ctx.fillStyle = active ? canvasTheme.selection : canvasTheme.selectionHandleFill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = canvasTheme.selection;
  ctx.stroke();
}

// A red crosshair: the operator's eye follows it to the next corner.
function paintSight(ctx: CanvasRenderingContext2D, at: Vec2, pointer: boolean): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = canvasTheme.previewHeadFill;
  ctx.beginPath();
  ctx.arc(at.x, at.y, pointer ? 6 : 8, 0, Math.PI * 2);
  ctx.moveTo(at.x - SIGHT_ARM_PX, at.y);
  ctx.lineTo(at.x + SIGHT_ARM_PX, at.y);
  ctx.moveTo(at.x, at.y - SIGHT_ARM_PX);
  ctx.lineTo(at.x, at.y + SIGHT_ARM_PX);
  ctx.stroke();
  if (pointer) {
    ctx.beginPath();
    ctx.arc(at.x, at.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = canvasTheme.previewHeadFill;
    ctx.fill();
  }
}

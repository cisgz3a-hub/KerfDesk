// design-annotation-draw — paints a dimension call-out on the overlay layer
// (ADR-268, DS-3b).
//
// Proper draughting conventions, because a dimension that looks like a stray line
// teaches nothing: witness (extension) lines run from the geometry out past the
// dimension line, the dimension line carries a filled arrowhead at each end, and
// the value sits in a chip on the line so it stays readable over anything.
//
// Lives on the interaction canvas, so appearing and disappearing as a field gains
// and loses focus costs one overlay repaint and never touches the drawing.

import type { Vec2 } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { DimensionAnnotation } from './design-measure-annotation';
import { mmToPx } from './design-view';
import type { DesignView } from './design-session';

const ARROW_LENGTH_PX = 8;
const ARROW_HALF_WIDTH_PX = 3;
const WITNESS_OVERSHOOT_PX = 5;
const WITNESS_GAP_PX = 2;
const LINE_WIDTH_PX = 1.25;
const LABEL_FONT = '11px system-ui, sans-serif';
const LABEL_PAD_PX = 4;
const LABEL_HEIGHT_PX = 16;
const POINT_RADIUS_PX = 4;
const DEG_TO_RAD = Math.PI / 180;

export function paintAnnotation(
  ctx: CanvasRenderingContext2D,
  view: DesignView,
  annotation: DimensionAnnotation,
  label: string,
): void {
  ctx.save();
  ctx.strokeStyle = canvasTheme.measureStroke;
  ctx.fillStyle = canvasTheme.measureStroke;
  ctx.lineWidth = LINE_WIDTH_PX;
  ctx.setLineDash([]);
  switch (annotation.kind) {
    case 'linear':
      paintLinear(ctx, view, annotation, label);
      break;
    case 'radial':
      paintRadial(ctx, view, annotation, label);
      break;
    case 'angular':
      paintAngular(ctx, view, annotation, label);
      break;
    case 'point':
      paintPoint(ctx, view, annotation, label);
      break;
  }
  ctx.restore();
}

function paintLinear(
  ctx: CanvasRenderingContext2D,
  view: DesignView,
  annotation: Extract<DimensionAnnotation, { kind: 'linear' }>,
  label: string,
): void {
  const from = mmToPx(view, annotation.fromMm);
  const to = mmToPx(view, annotation.toMm);
  const offset = offsetPx(view, annotation.offsetMm);
  const dimFrom = { x: from.x + offset.x, y: from.y + offset.y };
  const dimTo = { x: to.x + offset.x, y: to.y + offset.y };
  // Witness lines: from just off the geometry, out past the dimension line.
  if (offset.x !== 0 || offset.y !== 0) {
    strokeWitness(ctx, from, dimFrom);
    strokeWitness(ctx, to, dimTo);
  }
  strokeLine(ctx, dimFrom, dimTo);
  fillArrow(ctx, dimFrom, dimTo);
  fillArrow(ctx, dimTo, dimFrom);
  drawChip(ctx, midpoint(dimFrom, dimTo), label);
}

function paintRadial(
  ctx: CanvasRenderingContext2D,
  view: DesignView,
  annotation: Extract<DimensionAnnotation, { kind: 'radial' }>,
  label: string,
): void {
  const centre = mmToPx(view, annotation.centreMm);
  const edge = mmToPx(view, annotation.edgeMm);
  strokeLine(ctx, centre, edge);
  fillArrow(ctx, edge, centre);
  markCentre(ctx, centre);
  drawChip(ctx, midpoint(centre, edge), label);
}

function paintAngular(
  ctx: CanvasRenderingContext2D,
  view: DesignView,
  annotation: Extract<DimensionAnnotation, { kind: 'angular' }>,
  label: string,
): void {
  const centre = mmToPx(view, annotation.centreMm);
  const radiusPx = Math.abs(annotation.radiusMm) * view.pxPerMm;
  const startRad = annotation.startDeg * DEG_TO_RAD;
  const endRad = (annotation.startDeg + annotation.sweepDeg) * DEG_TO_RAD;
  // Legs out along both bounds of the angle, so the sweep is unambiguous.
  strokeLine(ctx, centre, polarPx(centre, radiusPx, startRad));
  strokeLine(ctx, centre, polarPx(centre, radiusPx, endRad));
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radiusPx, startRad, endRad, annotation.sweepDeg < 0);
  ctx.stroke();
  const midRad = (startRad + endRad) / 2;
  drawChip(ctx, polarPx(centre, radiusPx, midRad), label);
}

function paintPoint(
  ctx: CanvasRenderingContext2D,
  view: DesignView,
  annotation: Extract<DimensionAnnotation, { kind: 'point' }>,
  label: string,
): void {
  const at = mmToPx(view, annotation.atMm);
  ctx.beginPath();
  ctx.arc(at.x, at.y, POINT_RADIUS_PX, 0, Math.PI * 2);
  ctx.fill();
  drawChip(ctx, { x: at.x, y: at.y - LABEL_HEIGHT_PX }, label);
}

function offsetPx(view: DesignView, offsetMm: Vec2): Vec2 {
  return { x: offsetMm.x * view.pxPerMm, y: offsetMm.y * view.pxPerMm };
}

function strokeLine(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

// Starts a small gap off the geometry and overshoots the dimension line, which is
// the standard draughting look.
function strokeWitness(ctx: CanvasRenderingContext2D, atGeometry: Vec2, atDimension: Vec2): void {
  const dx = atDimension.x - atGeometry.x;
  const dy = atDimension.y - atGeometry.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const ux = dx / length;
  const uy = dy / length;
  strokeLine(
    ctx,
    { x: atGeometry.x + ux * WITNESS_GAP_PX, y: atGeometry.y + uy * WITNESS_GAP_PX },
    {
      x: atGeometry.x + ux * (length + WITNESS_OVERSHOOT_PX),
      y: atGeometry.y + uy * (length + WITNESS_OVERSHOOT_PX),
    },
  );
}

// Filled arrowhead AT `tip`, pointing away from `towards`.
function fillArrow(ctx: CanvasRenderingContext2D, tip: Vec2, towards: Vec2): void {
  const dx = tip.x - towards.x;
  const dy = tip.y - towards.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const ux = dx / length;
  const uy = dy / length;
  const baseX = tip.x - ux * ARROW_LENGTH_PX;
  const baseY = tip.y - uy * ARROW_LENGTH_PX;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(baseX - uy * ARROW_HALF_WIDTH_PX, baseY + ux * ARROW_HALF_WIDTH_PX);
  ctx.lineTo(baseX + uy * ARROW_HALF_WIDTH_PX, baseY - ux * ARROW_HALF_WIDTH_PX);
  ctx.closePath();
  ctx.fill();
}

function markCentre(ctx: CanvasRenderingContext2D, centre: Vec2): void {
  const arm = POINT_RADIUS_PX;
  strokeLine(ctx, { x: centre.x - arm, y: centre.y }, { x: centre.x + arm, y: centre.y });
  strokeLine(ctx, { x: centre.x, y: centre.y - arm }, { x: centre.x, y: centre.y + arm });
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function polarPx(centre: Vec2, radiusPx: number, angleRad: number): Vec2 {
  return {
    x: centre.x + Math.cos(angleRad) * radiusPx,
    y: centre.y + Math.sin(angleRad) * radiusPx,
  };
}

function drawChip(ctx: CanvasRenderingContext2D, at: Vec2, label: string): void {
  ctx.font = LABEL_FONT;
  const width = ctx.measureText(label).width + LABEL_PAD_PX * 2;
  const x = at.x - width / 2;
  const y = at.y - LABEL_HEIGHT_PX / 2;
  ctx.fillStyle = canvasTheme.noticeFill;
  ctx.fillRect(x, y, width, LABEL_HEIGHT_PX);
  ctx.strokeStyle = canvasTheme.measureStroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width, LABEL_HEIGHT_PX);
  ctx.fillStyle = canvasTheme.designGeometry;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, at.x, y + LABEL_HEIGHT_PX / 2);
  // Restore the annotation colour for whatever draws next.
  ctx.fillStyle = canvasTheme.measureStroke;
  ctx.strokeStyle = canvasTheme.measureStroke;
  ctx.textAlign = 'left';
}

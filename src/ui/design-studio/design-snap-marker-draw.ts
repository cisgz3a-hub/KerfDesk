// design-snap-marker-draw — the glyph that says WHICH snap captured the pointer
// (ADR-271, DS-4).
//
// A distinct glyph per snap type, following LightBurn, which shows a different
// cursor for each of its five snap kinds. One marker that means "snapped" is not
// enough: the operator has to know whether they caught the endpoint or merely the
// edge beside it, because those are millimetres apart and only one is the corner.
//
//   endpoint     filled square      — the node itself
//   midpoint     hollow triangle    — halfway
//   center       circle + crosshair — the centre, which is not on the geometry
//   quadrant     hollow diamond     — a compass point on a rim
//   intersection X                  — a crossing
//   on-line      short bar          — anywhere along an edge

import type { SnapTarget } from '../../core/design/snap';
import type { Vec2 } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { DesignView } from './design-session';
import { mmToPx } from './design-view';

const SIZE_PX = 5;
const LINE_WIDTH_PX = 1.5;
const TAU = Math.PI * 2;

export function paintSnapMarker(
  ctx: CanvasRenderingContext2D,
  view: DesignView,
  target: SnapTarget,
): void {
  const at = mmToPx(view, target.atMm);
  ctx.save();
  ctx.strokeStyle = canvasTheme.snapGuide;
  ctx.fillStyle = canvasTheme.snapGuide;
  ctx.lineWidth = LINE_WIDTH_PX;
  ctx.setLineDash([]);
  drawGlyph(ctx, at, target.kind);
  ctx.restore();
}

function drawGlyph(ctx: CanvasRenderingContext2D, at: Vec2, kind: SnapTarget['kind']): void {
  switch (kind) {
    case 'endpoint':
      ctx.fillRect(at.x - SIZE_PX, at.y - SIZE_PX, SIZE_PX * 2, SIZE_PX * 2);
      return;
    case 'midpoint':
      strokeTriangle(ctx, at);
      return;
    case 'center':
      strokeCentre(ctx, at);
      return;
    case 'quadrant':
      strokeDiamond(ctx, at);
      return;
    case 'intersection':
      strokeCross(ctx, at);
      return;
    case 'on-line':
      strokeBar(ctx, at);
      return;
  }
}

function strokeTriangle(ctx: CanvasRenderingContext2D, at: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(at.x, at.y - SIZE_PX);
  ctx.lineTo(at.x + SIZE_PX, at.y + SIZE_PX);
  ctx.lineTo(at.x - SIZE_PX, at.y + SIZE_PX);
  ctx.closePath();
  ctx.stroke();
}

function strokeCentre(ctx: CanvasRenderingContext2D, at: Vec2): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, SIZE_PX, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(at.x - SIZE_PX * 1.6, at.y);
  ctx.lineTo(at.x + SIZE_PX * 1.6, at.y);
  ctx.moveTo(at.x, at.y - SIZE_PX * 1.6);
  ctx.lineTo(at.x, at.y + SIZE_PX * 1.6);
  ctx.stroke();
}

function strokeDiamond(ctx: CanvasRenderingContext2D, at: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(at.x, at.y - SIZE_PX);
  ctx.lineTo(at.x + SIZE_PX, at.y);
  ctx.lineTo(at.x, at.y + SIZE_PX);
  ctx.lineTo(at.x - SIZE_PX, at.y);
  ctx.closePath();
  ctx.stroke();
}

function strokeCross(ctx: CanvasRenderingContext2D, at: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(at.x - SIZE_PX, at.y - SIZE_PX);
  ctx.lineTo(at.x + SIZE_PX, at.y + SIZE_PX);
  ctx.moveTo(at.x + SIZE_PX, at.y - SIZE_PX);
  ctx.lineTo(at.x - SIZE_PX, at.y + SIZE_PX);
  ctx.stroke();
}

function strokeBar(ctx: CanvasRenderingContext2D, at: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(at.x - SIZE_PX, at.y);
  ctx.lineTo(at.x + SIZE_PX, at.y);
  ctx.stroke();
}

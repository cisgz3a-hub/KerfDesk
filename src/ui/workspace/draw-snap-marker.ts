// draw-snap-marker — the glyph at the point the pointer snapped to (LBG-F06).
//
// One glyph per snap kind, the Design Studio's (ADR-272), so the operator can
// tell the node from the midpoint beside it before letting go:
//
//   node          filled square
//   midpoint      hollow triangle
//   centre        circle with a crosshair
//   intersection  X
//   grid          small plus — both axes on grid lines

import { canvasTheme } from '../theme/canvas-theme';
import { paintSnapGlyphPx } from '../design-studio/design-snap-marker-draw';
import type { SnapMarker } from './snap/snap-kinds';
import type { ViewTransform } from './view-transform';

const GRID_ARM_PX = 4;

export function drawSnapMarker(
  ctx: CanvasRenderingContext2D,
  marker: SnapMarker,
  view: ViewTransform,
): void {
  const at = {
    x: view.offsetX + marker.pointMm.x * view.scale,
    y: view.offsetY + marker.pointMm.y * view.scale,
  };
  if (marker.kind === 'grid') {
    drawGridGlyph(ctx, at);
    return;
  }
  paintSnapGlyphPx(ctx, at, marker.kind === 'node' ? 'endpoint' : marker.kind);
}

function drawGridGlyph(ctx: CanvasRenderingContext2D, at: { x: number; y: number }): void {
  ctx.save();
  ctx.strokeStyle = canvasTheme.snapGuide;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(at.x - GRID_ARM_PX, at.y);
  ctx.lineTo(at.x + GRID_ARM_PX, at.y);
  ctx.moveTo(at.x, at.y - GRID_ARM_PX);
  ctx.lineTo(at.x, at.y + GRID_ARM_PX);
  ctx.stroke();
  ctx.restore();
}

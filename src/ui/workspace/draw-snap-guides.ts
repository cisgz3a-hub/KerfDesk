import { canvasTheme } from '../theme/canvas-theme';
import type { SnapGuide } from './snapping';
import type { ViewTransform } from './view-transform';

export function drawSnapGuides(
  ctx: CanvasRenderingContext2D,
  guides: ReadonlyArray<SnapGuide>,
  view: ViewTransform,
): void {
  if (guides.length === 0) return;
  ctx.save();
  ctx.strokeStyle = canvasTheme.snapGuide;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const guide of guides) drawGuide(ctx, guide, view);
  ctx.restore();
}

function drawGuide(ctx: CanvasRenderingContext2D, guide: SnapGuide, view: ViewTransform): void {
  const from = Math.min(guide.fromMm, guide.toMm);
  const to = Math.max(guide.fromMm, guide.toMm);
  ctx.beginPath();
  if (guide.axis === 'x') {
    const x = view.offsetX + guide.positionMm * view.scale;
    ctx.moveTo(x, view.offsetY + from * view.scale);
    ctx.lineTo(x, view.offsetY + to * view.scale);
  } else {
    const y = view.offsetY + guide.positionMm * view.scale;
    ctx.moveTo(view.offsetX + from * view.scale, y);
    ctx.lineTo(view.offsetX + to * view.scale, y);
  }
  ctx.stroke();
}

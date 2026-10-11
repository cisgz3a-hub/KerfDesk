import type { SketchExtension } from '../../core/design/ops/extend-sketch';
import { canvasTheme } from '../theme/canvas-theme';
import type { DesignView } from './design-session';
import { mmToPx } from './design-view';

export function paintExtension(
  ctx: CanvasRenderingContext2D,
  view: DesignView,
  preview: SketchExtension,
): void {
  const from = mmToPx(view, preview.from);
  ctx.save();
  ctx.strokeStyle = canvasTheme.selection;
  ctx.fillStyle = canvasTheme.selection;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  if (preview.to !== null) {
    const to = mmToPx(view, preview.to);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(to.x, to.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(from.x, from.y, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

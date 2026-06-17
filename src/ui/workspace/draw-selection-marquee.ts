import { canvasTheme } from '../theme/canvas-theme';
import type { SelectionMarquee } from '../state/ui-store';
import type { ViewTransform } from './view-transform';

export function drawSelectionMarquee(
  ctx: CanvasRenderingContext2D,
  marquee: SelectionMarquee,
  view: ViewTransform,
): void {
  const x1 = view.offsetX + marquee.start.x * view.scale;
  const y1 = view.offsetY + marquee.start.y * view.scale;
  const x2 = view.offsetX + marquee.end.x * view.scale;
  const y2 = view.offsetY + marquee.end.y * view.scale;
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  ctx.save();
  ctx.fillStyle = canvasTheme.selectionMarqueeFill;
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 3]);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

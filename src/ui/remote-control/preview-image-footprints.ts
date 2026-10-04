import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from '../workspace/view-transform';
import type { PreviewImageFootprint } from './preview-validation';

/** Dashed placement frames deliberately contain no substitute image pixels. */
export function paintPreviewImageFootprints(
  ctx: CanvasRenderingContext2D,
  footprints: readonly PreviewImageFootprint[],
  view: ViewTransform,
): void {
  if (footprints.length === 0) return;
  ctx.save();
  ctx.strokeStyle = canvasTheme.artworkInk;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  for (const footprint of footprints) {
    const [start, ...rest] = footprint.corners;
    if (start === undefined) continue;
    ctx.beginPath();
    ctx.moveTo(view.offsetX + start.x * view.scale, view.offsetY + start.y * view.scale);
    for (const point of [...rest, start])
      ctx.lineTo(view.offsetX + point.x * view.scale, view.offsetY + point.y * view.scale);
    ctx.stroke();
  }
  ctx.restore();
}

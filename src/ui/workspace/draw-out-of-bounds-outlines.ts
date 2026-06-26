import { transformedBBox, type Project } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { isObjectOutOfBed } from './out-of-bounds';
import type { ViewTransform } from './view-transform';

export function drawOutOfBoundsOutlines(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  const bedW = project.device.bedWidth;
  const bedH = project.device.bedHeight;
  for (const obj of project.scene.objects) {
    if (!isObjectOutOfBed(obj, bedW, bedH)) continue;
    const bbox = transformedBBox(obj);
    ctx.save();
    ctx.strokeStyle = canvasTheme.outOfBounds;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(
      view.offsetX + bbox.minX * view.scale,
      view.offsetY + bbox.minY * view.scale,
      (bbox.maxX - bbox.minX) * view.scale,
      (bbox.maxY - bbox.minY) * view.scale,
    );
    ctx.restore();
  }
}

import type { Project } from '../../core/scene';
import { selectedOpenFillContours } from '../common/fill-diagnostics';
import { canvasTheme } from '../theme/canvas-theme';
import { strokePolylinesBatched } from './draw-vector-strokes';
import type { ViewTransform } from './view-transform';

export function drawSelectedOpenFillContours(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
  selectedId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): void {
  const groups = selectedOpenFillContours(project, selectedId, additionalSelectedIds);
  if (groups.length === 0) return;

  ctx.save();
  ctx.strokeStyle = canvasTheme.openFillContour;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  for (const group of groups) {
    strokePolylinesBatched(ctx, group.object, group.polylines, view);
  }
  ctx.restore();
}

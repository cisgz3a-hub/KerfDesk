// drawCncStock — the workpiece footprint on the bed (Phase H.2, ADR-098).
// Machine-coordinate stock rect mapped into scene space (the origin transform
// may flip an axis), drawn as a faint fill + dashed outline under the
// artwork so the operator always sees where the material is.

import { toSceneCoords } from '../../core/devices';
import type { Project } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from './view-transform';

const STOCK_DASH: ReadonlyArray<number> = [6, 4];

export function drawCncStock(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc') return;
  const stock = machine.stock;
  const a = toSceneCoords(stock.originOffset, project.device);
  const b = toSceneCoords(
    { x: stock.originOffset.x + stock.widthMm, y: stock.originOffset.y + stock.heightMm },
    project.device,
  );
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);

  const px = view.offsetX + minX * view.scale;
  const py = view.offsetY + minY * view.scale;
  ctx.save();
  ctx.fillStyle = canvasTheme.stockFill;
  ctx.fillRect(px, py, w * view.scale, h * view.scale);
  ctx.strokeStyle = canvasTheme.stockStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([...STOCK_DASH]);
  ctx.strokeRect(px, py, w * view.scale, h * view.scale);
  ctx.restore();
}

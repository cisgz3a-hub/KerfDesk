import { transformedBBox, type SceneObject } from '../../core/scene';
import type { ArtworkRunFocus } from '../state/artwork-run-order-ui';
import { canvasTheme } from '../theme/canvas-theme';
import type { ViewTransform } from './view-transform';

export function drawArtworkRunFocus(
  ctx: CanvasRenderingContext2D,
  objects: ReadonlyArray<SceneObject>,
  focus: ArtworkRunFocus,
  view: ViewTransform,
): void {
  const active = objects.filter((object) => focus.objectIds.includes(object.id));
  if (active.length === 0) return;
  const boxes = active.map(transformedBBox);
  const minX = Math.min(...boxes.map((box) => box.minX));
  const minY = Math.min(...boxes.map((box) => box.minY));
  const maxX = Math.max(...boxes.map((box) => box.maxX));
  const maxY = Math.max(...boxes.map((box) => box.maxY));
  const x = view.offsetX + minX * view.scale;
  const y = view.offsetY + minY * view.scale;
  const width = Math.max(1, (maxX - minX) * view.scale);
  const height = Math.max(1, (maxY - minY) * view.scale);
  ctx.save();
  ctx.strokeStyle = focus.color;
  ctx.lineWidth = 7;
  ctx.globalAlpha = 0.22;
  ctx.strokeRect(x - 4, y - 4, width + 8, height + 8);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 2, y - 2, width + 4, height + 4);
  drawNumberBadge(ctx, x - 2, y - 2, focus.position, focus.color);
  ctx.restore();
}

function drawNumberBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  position: number,
  color: string,
): void {
  const label = `#${position}`;
  const width = Math.max(28, 14 + label.length * 7);
  const badgeY = y - 25;
  ctx.fillStyle = color;
  ctx.fillRect(x, badgeY, width, 21);
  ctx.fillStyle = canvasTheme.selectionHandleFill;
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + width / 2, badgeY + 10.5);
}

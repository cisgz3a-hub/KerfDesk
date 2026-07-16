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
  const x = view.offsetX + minX * view.scale;
  const y = view.offsetY + minY * view.scale;
  ctx.save();
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
  drawOpenAccent(ctx, x + width + 6, badgeY + 10.5, color);
  ctx.fillStyle = color;
  ctx.fillRect(x, badgeY, width, 21);
  ctx.fillStyle = canvasTheme.selectionHandleFill;
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + width / 2, badgeY + 10.5);
}

function drawOpenAccent(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 7;
  drawAccentLine(ctx, x, y);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  drawAccentLine(ctx, x, y);
}

function drawAccentLine(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 24, y);
  ctx.stroke();
}

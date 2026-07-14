import type { Vec2 } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { SELECTION_MOVE_HANDLE_SCREEN_PX } from './selection-move-handle';
import type { ViewTransform } from './view-transform';

const MOVE_GLYPH_HALF_PX = 4;
const MOVE_ARROW_HEAD_PX = 2;

export function drawSelectionMoveHandle(
  ctx: CanvasRenderingContext2D,
  position: Vec2,
  view: ViewTransform,
): void {
  const x = view.offsetX + position.x * view.scale;
  const y = view.offsetY + position.y * view.scale;
  const radius = SELECTION_MOVE_HANDLE_SCREEN_PX / 2;
  ctx.save();
  ctx.fillStyle = canvasTheme.selection;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = canvasTheme.selectionHandleFill;
  ctx.lineWidth = 1.5;
  strokeMoveGlyph(ctx, x, y);
  ctx.restore();
}

function strokeMoveGlyph(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const half = MOVE_GLYPH_HALF_PX;
  const head = MOVE_ARROW_HEAD_PX;
  ctx.beginPath();
  ctx.moveTo(x - half, y);
  ctx.lineTo(x + half, y);
  ctx.moveTo(x, y - half);
  ctx.lineTo(x, y + half);
  ctx.moveTo(x - half, y);
  ctx.lineTo(x - half + head, y - head);
  ctx.moveTo(x - half, y);
  ctx.lineTo(x - half + head, y + head);
  ctx.moveTo(x + half, y);
  ctx.lineTo(x + half - head, y - head);
  ctx.moveTo(x + half, y);
  ctx.lineTo(x + half - head, y + head);
  ctx.moveTo(x, y - half);
  ctx.lineTo(x - head, y - half + head);
  ctx.moveTo(x, y - half);
  ctx.lineTo(x + head, y - half + head);
  ctx.moveTo(x, y + half);
  ctx.lineTo(x - head, y + half - head);
  ctx.moveTo(x, y + half);
  ctx.lineTo(x + head, y + half - head);
  ctx.stroke();
}

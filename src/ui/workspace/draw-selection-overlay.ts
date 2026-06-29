import type { SceneObject } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { drawPathNodeHandles } from './draw-path-node-handles';
import { type Handle, HANDLE_SCREEN_PX, handlesFor, selectionFrameFor } from './handles';
import { rotateHandlePosition } from './rotate-handle';
import type { ViewTransform } from './view-transform';

export function drawObjectSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  view: ViewTransform,
  args: {
    readonly isVisible: boolean;
    readonly selectedId: string | null;
    readonly showPathNodeHandles: boolean;
    readonly selectedPathNode: PathNodeRef | null;
    readonly selectedPathNodes: ReadonlyArray<PathNodeRef>;
    readonly additionalSelectedIds: ReadonlySet<string>;
  },
): void {
  if (!args.isVisible) return;
  if (obj.id === args.selectedId) {
    drawSelectionBox(ctx, obj, view);
    if (args.showPathNodeHandles) {
      drawPathNodeHandles(ctx, obj, view, args.selectedPathNode, args.selectedPathNodes);
    }
    return;
  }
  if (args.additionalSelectedIds.has(obj.id)) {
    drawSecondarySelectionBox(ctx, obj, view);
  }
}

function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  view: ViewTransform,
): void {
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  strokeSelectionFrame(ctx, selectionFrameFor(obj), view);
  ctx.setLineDash([]);
  drawHandles(ctx, obj, view);
}

function drawSecondarySelectionBox(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  view: ViewTransform,
): void {
  ctx.save();
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.globalAlpha = 0.7;
  strokeSelectionFrame(ctx, selectionFrameFor(obj), view);
  ctx.restore();
}

function strokeSelectionFrame(
  ctx: CanvasRenderingContext2D,
  frame: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  view: ViewTransform,
): void {
  const [first, ...rest] = frame;
  if (first === undefined) return;
  ctx.beginPath();
  ctx.moveTo(view.offsetX + first.x * view.scale, view.offsetY + first.y * view.scale);
  for (const point of rest) {
    ctx.lineTo(view.offsetX + point.x * view.scale, view.offsetY + point.y * view.scale);
  }
  ctx.closePath();
  ctx.stroke();
}

function drawHandles(ctx: CanvasRenderingContext2D, obj: SceneObject, view: ViewTransform): void {
  ctx.fillStyle = canvasTheme.selectionHandleFill;
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1.5;
  const half = HANDLE_SCREEN_PX / 2;
  for (const h of handlesFor(obj)) drawSingleHandle(ctx, h, view, half);
  drawRotateHandle(ctx, obj, view);
}

function drawSingleHandle(
  ctx: CanvasRenderingContext2D,
  h: Handle,
  view: ViewTransform,
  half: number,
): void {
  const cx = view.offsetX + h.position.x * view.scale;
  const cy = view.offsetY + h.position.y * view.scale;
  ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
  ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
}

function drawRotateHandle(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  view: ViewTransform,
): void {
  const pos = rotateHandlePosition(obj);
  const cx = view.offsetX + pos.x * view.scale;
  const cy = view.offsetY + pos.y * view.scale;
  const bboxTopMidScreenY = cy + 24 * view.scale;
  ctx.save();
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(cx, bboxTopMidScreenY);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = canvasTheme.selection;
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = canvasTheme.rotateHandleStroke;
  ctx.stroke();
  ctx.restore();
}

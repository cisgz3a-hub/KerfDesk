import { combinedBBox, type AABB, type SceneObject } from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import type { PathNodeRef } from '../state/path-node-edit-actions';
import { drawPathNodeHandles } from './draw-path-node-handles';
import { type Handle, HANDLE_SCREEN_PX, handlesFor, selectionFrameFor } from './handles';
import { ROTATE_HANDLE_OFFSET_MM, rotateHandlePosition } from './rotate-handle';
import { aabbHandlePoints } from './selection-handles';
import { drawSelectionMoveHandle } from './draw-selection-move-handle';
import { selectionMoveHandlePosition } from './selection-move-handle';
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
    if (args.additionalSelectedIds.size > 0) {
      drawSecondarySelectionBox(ctx, obj, view);
      return;
    }
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

export function drawSelectionSetOverlay(
  ctx: CanvasRenderingContext2D,
  objects: ReadonlyArray<SceneObject>,
  view: ViewTransform,
): void {
  const bbox = combinedBBox(objects);
  if (bbox === null) return;
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  strokeSelectionFrame(ctx, selectionFrameForAabb(bbox), view);
  ctx.setLineDash([]);
  drawRotateHandleAt(ctx, rotateHandlePositionForAabb(bbox), bbox.minY, view);
  // Scale handles on the combined box so the whole selection can be resized by
  // handle, not only via the numeric W/H fields (audit C5).
  ctx.fillStyle = canvasTheme.selectionHandleFill;
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1.5;
  const half = HANDLE_SCREEN_PX / 2;
  for (const handle of aabbHandlePoints(bbox)) drawSingleHandle(ctx, handle, view, half);
  drawMoveHandleFor(ctx, objects, view);
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
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
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
  drawMoveHandleFor(ctx, [obj], view);
}

function drawMoveHandleFor(
  ctx: CanvasRenderingContext2D,
  objects: ReadonlyArray<SceneObject>,
  view: ViewTransform,
): void {
  const position = selectionMoveHandlePosition(objects);
  if (position !== null) drawSelectionMoveHandle(ctx, position, view);
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
  drawRotateHandleAt(ctx, pos, pos.y + ROTATE_HANDLE_OFFSET_MM, view);
}

function drawRotateHandleAt(
  ctx: CanvasRenderingContext2D,
  pos: { readonly x: number; readonly y: number },
  bboxTopY: number,
  view: ViewTransform,
): void {
  const cx = view.offsetX + pos.x * view.scale;
  const cy = view.offsetY + pos.y * view.scale;
  const bboxTopMidScreenY = view.offsetY + bboxTopY * view.scale;
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

function selectionFrameForAabb(
  bbox: AABB,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  return [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.maxY },
  ];
}

function rotateHandlePositionForAabb(bbox: AABB): { readonly x: number; readonly y: number } {
  return {
    x: (bbox.minX + bbox.maxX) / 2,
    y: bbox.minY - ROTATE_HANDLE_OFFSET_MM,
  };
}

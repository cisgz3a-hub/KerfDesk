import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Project, SceneObject, Vec2 } from '../../core/scene';
import type { ToolMode } from '../state/ui-store';
import type { DragState } from './drag-state';
import { hitSelectionMoveHandle } from './selection-move-handle';
import { canvasMouseToScene, pxToMmForCanvas } from './view-transform';

type CursorViewState = {
  readonly zoomFactor: number;
  readonly panX: number;
  readonly panY: number;
};

export function selectionMoveCursor(args: {
  readonly isMoving: boolean;
  readonly isEnabled: boolean;
  readonly objects: ReadonlyArray<SceneObject>;
  readonly point: Vec2 | null;
  readonly pxToMm: number;
}): '' | 'move' {
  if (args.isMoving) return 'move';
  if (!args.isEnabled || args.point === null) return '';
  return hitSelectionMoveHandle(args.objects, args.point, args.pxToMm) ? 'move' : '';
}

export function updateSelectionMoveCursor(args: {
  readonly e: ReactMouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly drag: DragState | null;
  readonly project: Project;
  readonly previewMode: boolean;
  readonly viewState: CursorViewState;
  readonly toolMode: ToolMode;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
}): void {
  const canvas = args.canvas;
  if (canvas === null) return;
  const point = canvasMouseToScene(args.e, canvas, args.project, args.viewState);
  const pxToMm = pxToMmForCanvas(canvas, args.project, args.viewState);
  const selectedIds = new Set([
    ...(args.selectedObjectId === null ? [] : [args.selectedObjectId]),
    ...args.additionalSelectedIds,
  ]);
  const objects = args.project.scene.objects.filter((object) => selectedIds.has(object.id));
  canvas.style.cursor = selectionMoveCursor({
    isMoving: args.drag?.kind === 'move',
    isEnabled: !args.previewMode && args.drag === null && args.toolMode.kind === 'select',
    objects,
    point,
    pxToMm,
  });
}

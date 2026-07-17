import type { MouseEvent, RefObject } from 'react';
import { hitTest, type Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import type { DragState } from './drag-state';
import { isStationaryRightPanClick } from './pan-drag';
import { canvasMouseToScene, type ViewState } from './view-transform';

export function openContextBarForRightClick(args: {
  readonly drag: Extract<DragState, { kind: 'pan' }>;
  readonly e: MouseEvent<HTMLCanvasElement>;
  readonly ref: RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly selectObject: (id: string | null) => void;
}): void {
  if (useStore.getState().previewMode) return;
  if (args.e.type !== 'mouseup' || !isStationaryRightPanClick(args.drag, args.e)) return;
  const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  const hitId = point === null ? null : hitTest(args.project.scene, point);
  if (hitId !== null) args.selectObject(hitId);
  const current = useStore.getState();
  const hasSelection =
    hitId !== null || current.selectedObjectId !== null || current.additionalSelectedIds.size > 0;
  useUiStore.getState().openWorkspaceContextBar({
    x: args.e.clientX,
    y: args.e.clientY,
    context: hasSelection ? 'workspace-selection' : 'workspace-empty',
  });
}

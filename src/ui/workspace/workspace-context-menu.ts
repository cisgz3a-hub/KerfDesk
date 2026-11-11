import type { MouseEvent, RefObject } from 'react';
import { type Project, type Vec2 } from '../../core/scene';
import { workspaceHitTest } from './workspace-hit-test';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import type { DragState } from './drag-state';
import { isStationaryRightPanClick } from './pan-drag';
import { canvasMouseToScene, type ViewState } from './view-transform';
import { selectTracePartForContextMenu } from './trace-part-tool';

type RightClickArgs = {
  readonly drag: Extract<DragState, { kind: 'pan' }>;
  readonly e: MouseEvent<HTMLCanvasElement>;
  readonly ref: RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly selectObject: (id: string | null) => void;
};

export function openContextBarForRightClick(args: RightClickArgs): void {
  if (useStore.getState().previewMode) return;
  const isRelease = args.e.type === 'mouseup' || args.e.type === 'pointerup';
  if (!isRelease || !isStationaryRightPanClick(args.drag, args.e)) return;
  let lockedObjectId: string | null = null;
  if (useUiStore.getState().toolMode.kind === 'trace-parts') {
    if (!selectTracePartForContextMenu(args)) return;
  } else {
    lockedObjectId = selectUnderRightClick(args);
  }
  const current = useStore.getState();
  const hasSelection = current.selectedObjectId !== null || current.additionalSelectedIds.size > 0;
  useUiStore.getState().openWorkspaceContextBar({
    x: args.e.clientX,
    y: args.e.clientY,
    context: hasSelection ? 'workspace-selection' : 'workspace-empty',
    ...(lockedObjectId === null ? {} : { lockedObjectId }),
  });
}

/**
 * Selects the artwork under the pointer, or clears the selection. Locked
 * artwork cannot be selected, so a right-click on it used to find nothing and
 * offer no way to free it but Unlock All (annoyance audit A4-P2-3): its id is
 * returned for the menu's Unlock item.
 */
function selectUnderRightClick(args: RightClickArgs): string | null {
  const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  const hitId = point === null ? null : workspaceHitTest(args.project.scene, point);
  args.selectObject(hitId);
  if (hitId !== null || point === null) return null;
  return lockedObjectAt(args.project, point);
}

function lockedObjectAt(project: Project, point: Vec2): string | null {
  const id = workspaceHitTest(project.scene, point, { includeLocked: true });
  if (id === null) return null;
  const object = project.scene.objects.find((candidate) => candidate.id === id);
  return object?.locked === true ? id : null;
}

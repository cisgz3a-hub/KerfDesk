import type { MouseEvent, RefObject } from 'react';
import { type Project, type SceneObject, type Vec2 } from '../../core/scene';
import { workspaceHitTest } from './workspace-hit-test';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import type { DragState } from './drag-state';
import { isStationaryRightPanClick } from './pan-drag';
import { hitSelectionMoveHandle } from './selection-move-handle';
import { canvasMouseToScene, pxToMmForCanvas, type ViewState } from './view-transform';
import { selectTracePartForContextMenu } from './trace-part-tool';

type RightClickArgs = {
  readonly drag: Extract<DragState, { kind: 'pan' }>;
  readonly e: MouseEvent<HTMLCanvasElement>;
  readonly ref: RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly selectObject: (id: string | null) => void;
};

type RightClickTarget = {
  /** The click landed on artwork, which is now (or still) selected. */
  readonly onArtwork: boolean;
  /** Locked artwork under the pointer, for the menu's Unlock item (ADR-706). */
  readonly lockedObjectId: string | null;
};

export function openContextBarForRightClick(args: RightClickArgs): void {
  if (useStore.getState().previewMode) return;
  const isRelease = args.e.type === 'mouseup' || args.e.type === 'pointerup';
  if (!isRelease || !isStationaryRightPanClick(args.drag, args.e)) return;
  let target: RightClickTarget;
  if (useUiStore.getState().toolMode.kind === 'trace-parts') {
    if (!selectTracePartForContextMenu(args)) return;
    const current = useStore.getState();
    target = {
      onArtwork: current.selectedObjectId !== null || current.additionalSelectedIds.size > 0,
      lockedObjectId: null,
    };
  } else {
    target = selectUnderRightClick(args);
  }
  useUiStore.getState().openWorkspaceContextBar({
    x: args.e.clientX,
    y: args.e.clientY,
    context: target.onArtwork ? 'workspace-selection' : 'workspace-empty',
    ...(target.lockedObjectId === null ? {} : { lockedObjectId: target.lockedObjectId }),
  });
}

/**
 * What a stationary right-click selects (ADR-196 Amendment 1). On an object of
 * the current selection, or on the selection's move handle, the selection is
 * kept: the menu's Group, Align and Distribute need it, and a right-click used
 * to cut it down to the one object under the pointer (annoyance audit A2,
 * B6-P2-1). On an object that is not selected, that object is selected alone.
 * On empty canvas the selection is kept too and the empty-canvas menu opens.
 *
 * Locked artwork cannot be selected, so a right-click on it finds nothing; its
 * id is returned for the menu's Unlock item (annoyance audit A4-P2-3).
 */
function selectUnderRightClick(args: RightClickArgs): RightClickTarget {
  const point = canvasMouseToScene(args.e, args.ref.current, args.project, args.viewState);
  if (point === null) return { onArtwork: false, lockedObjectId: null };
  const pxToMm = pxToMmForCanvas(args.ref.current, args.project, args.viewState);
  const selected = selectedObjects(args.project);
  if (hitSelectionMoveHandle(selected, point, pxToMm)) {
    return { onArtwork: true, lockedObjectId: null };
  }
  const hitId = workspaceHitTest(args.project.scene, point, pxToMm);
  if (hitId === null) {
    return { onArtwork: false, lockedObjectId: lockedObjectAt(args.project, point, pxToMm) };
  }
  if (!selected.some((object) => object.id === hitId)) args.selectObject(hitId);
  return { onArtwork: true, lockedObjectId: null };
}

function selectedObjects(project: Project): ReadonlyArray<SceneObject> {
  const { selectedObjectId, additionalSelectedIds } = useStore.getState();
  return project.scene.objects.filter(
    (object) => object.id === selectedObjectId || additionalSelectedIds.has(object.id),
  );
}

function lockedObjectAt(project: Project, point: Vec2, pxToMm: number): string | null {
  const id = workspaceHitTest(project.scene, point, pxToMm, { includeLocked: true });
  if (id === null) return null;
  const object = project.scene.objects.find((candidate) => candidate.id === id);
  return object?.locked === true ? id : null;
}

// Workspace drag state machine — discriminated-union for move / scale /
// rotate / pan, plus the pure helpers that translate a mouse event into
// the next object transform (or the next pan offset). Extracted from
// Workspace.tsx to stay under the file-size cap; the hook in Workspace
// owns the React state + listeners, the helpers here are testable
// without rendering.

import { hitTest, type Project, type SceneObject, type Transform, type Vec2 } from '../../core/scene';
import { useUiStore } from '../state/ui-store';
import { type HandleKind, hitHandle, scaleObjectByHandleDrag } from './handles';
import { hitRotateHandle, rotateObjectByDrag } from './rotate-handle';
import { canvasMouseToScene, computeView, pxToMmForCanvas } from './view-transform';

export type DragState =
  | {
      readonly kind: 'move';
      readonly objectId: string;
      readonly startScenePoint: Vec2;
      readonly startTx: number;
      readonly startTy: number;
    }
  | {
      readonly kind: 'scale';
      readonly objectId: string;
      readonly handle: HandleKind;
    }
  | {
      readonly kind: 'rotate';
      readonly objectId: string;
    }
  | {
      readonly kind: 'pan';
      readonly startClientX: number;
      readonly startClientY: number;
      readonly startPanX: number;
      readonly startPanY: number;
    };

// Decide what kind of drag a mouse-down on `point` initiates, based on the
// selected object's handle layout. Returns null if the click missed all
// handles (caller falls through to body hit-test).
export function pickHandleDrag(args: {
  readonly selectedObj: SceneObject;
  readonly point: Vec2;
  readonly pxToMm: number;
}): DragState | null {
  const { selectedObj, point, pxToMm } = args;
  if (hitRotateHandle(selectedObj, point, pxToMm)) {
    return { kind: 'rotate', objectId: selectedObj.id };
  }
  const handle = hitHandle(selectedObj, point, pxToMm);
  if (handle !== null) {
    return { kind: 'scale', objectId: selectedObj.id, handle };
  }
  return null;
}

// Resolve a mouse-down event to the drag it should initiate. Pure of
// React — takes side-effect callbacks (selection updates) so the hook in
// Workspace stays under the function-line cap.
export function computeMouseDownDrag(args: {
  readonly e: React.MouseEvent<HTMLCanvasElement>;
  readonly ref: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly viewState: { readonly zoomFactor: number; readonly panX: number; readonly panY: number };
  readonly onShiftClick: (id: string) => void;
  readonly onPlainClick: (id: string | null) => void;
}): DragState | null {
  const { e, ref, project, selectedObjectId, viewState, onShiftClick, onPlainClick } = args;
  if (useUiStore.getState().spaceDown) {
    return {
      kind: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: useUiStore.getState().panX,
      startPanY: useUiStore.getState().panY,
    };
  }
  const point = canvasMouseToScene(e, ref.current, project, viewState);
  if (point === null) return null;
  const selectedObj = project.scene.objects.find((o) => o.id === selectedObjectId);
  if (selectedObj !== undefined) {
    const pxToMm = pxToMmForCanvas(ref.current, project, viewState);
    const handleDrag = pickHandleDrag({ selectedObj, point, pxToMm });
    if (handleDrag !== null) return handleDrag;
  }
  const hitId = hitTest(project.scene, point);
  if (e.shiftKey) {
    if (hitId !== null) onShiftClick(hitId);
    return null;
  }
  onPlainClick(hitId);
  if (hitId === null) return null;
  const obj = project.scene.objects.find((o) => o.id === hitId);
  if (obj === undefined) return null;
  return {
    kind: 'move',
    objectId: hitId,
    startScenePoint: point,
    startTx: obj.transform.x,
    startTy: obj.transform.y,
  };
}

// Convert a pan-drag mousemove into the next (panX, panY) in scene-mm.
export function panOffsetForDrag(args: {
  readonly drag: Extract<DragState, { kind: 'pan' }>;
  readonly e: { readonly clientX: number; readonly clientY: number };
  readonly canvas: HTMLCanvasElement;
  readonly project: Project;
  readonly viewState: { readonly zoomFactor: number; readonly panX: number; readonly panY: number };
}): { readonly panX: number; readonly panY: number } {
  const rect = args.canvas.getBoundingClientRect();
  const cssScale = rect.width / args.canvas.width;
  const view = computeView(
    args.canvas.width,
    args.canvas.height,
    args.project.device.bedWidth,
    args.project.device.bedHeight,
    args.viewState,
  );
  const dxMm = ((args.e.clientX - args.drag.startClientX) / cssScale) / view.scale;
  const dyMm = ((args.e.clientY - args.drag.startClientY) / cssScale) / view.scale;
  return { panX: args.drag.startPanX + dxMm, panY: args.drag.startPanY + dyMm };
}

// Compute the next transform for a move/scale/rotate drag event. Pan
// drags never reach this function (the caller handles them before
// computing a scene point).
export function nextTransformForDrag(
  drag: Exclude<DragState, { kind: 'pan' }>,
  obj: SceneObject,
  point: Vec2,
  e: { readonly shiftKey: boolean; readonly altKey: boolean },
): Transform {
  if (drag.kind === 'move') {
    return {
      ...obj.transform,
      x: drag.startTx + (point.x - drag.startScenePoint.x),
      y: drag.startTy + (point.y - drag.startScenePoint.y),
    };
  }
  if (drag.kind === 'scale') {
    return scaleObjectByHandleDrag({
      object: obj,
      handle: drag.handle,
      dragTo: point,
      lockAspect: e.shiftKey,
      fromCenter: e.altKey,
    });
  }
  return rotateObjectByDrag({ object: obj, dragTo: point, snap: e.shiftKey });
}

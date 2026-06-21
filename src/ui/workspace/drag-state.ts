// Workspace drag state machine — discriminated-union for move / scale /
// rotate / pan, plus the pure helpers that translate a mouse event into
// the next object transform (or the next pan offset). Extracted from
// Workspace.tsx to stay under the file-size cap; the hook in Workspace
// owns the React state + listeners, the helpers here are testable
// without rendering.

import {
  hitTest,
  type Project,
  type SceneObject,
  type SelectionAnchor,
  type Transform,
  type Vec2,
} from '../../core/scene';
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
      readonly trigger: 'middle-button' | 'right-button' | 'space-left-button';
      readonly startClientX: number;
      readonly startClientY: number;
      readonly startPanX: number;
      readonly startPanY: number;
    }
  // Phase G (ADR-051, B5): dragging out a new shape from `startScenePoint`.
  // Handled entirely in the Workspace mouse layer (like 'pan') — never reaches
  // nextTransformForDrag, since there's no object to transform until commit.
  | {
      readonly kind: 'draw';
      readonly shape: 'rect' | 'ellipse' | 'polygon';
      readonly startScenePoint: Vec2;
    }
  | {
      readonly kind: 'marquee';
      readonly startScenePoint: Vec2;
      readonly additive: boolean;
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

// Mouse button codes per the DOM event spec / React's MouseEvent. We
// trigger pan on middle OR right — CAD convention, so users don't have
// to learn the Space modifier to pan with a regular mouse.
const MIDDLE_BUTTON = 1;
const RIGHT_BUTTON = 2;
const CONTEXT_CLICK_TOLERANCE_PX = 4;

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
  // Three pan triggers: Space-held + left button (existing), middle
  // button (CAD convention), right button (alternative for users
  // without middle button). All three create the same pan DragState
  // and use the same downstream offset math.
  const trigger = panTriggerForMouseDown(e.button, useUiStore.getState().spaceDown);
  if (trigger !== null) {
    return {
      kind: 'pan',
      trigger,
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
  if (hitId === null) {
    return { kind: 'marquee', startScenePoint: point, additive: e.shiftKey };
  }
  if (e.shiftKey) {
    onShiftClick(hitId);
    return null;
  }
  onPlainClick(hitId);
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

function panTriggerForMouseDown(
  button: number,
  spaceDown: boolean,
): Extract<DragState, { kind: 'pan' }>['trigger'] | null {
  if (spaceDown && button === 0) return 'space-left-button';
  if (button === MIDDLE_BUTTON) return 'middle-button';
  if (button === RIGHT_BUTTON) return 'right-button';
  return null;
}

export function isStationaryRightPanClick(
  drag: Extract<DragState, { kind: 'pan' }>,
  e: { readonly clientX: number; readonly clientY: number },
): boolean {
  if (drag.trigger !== 'right-button') return false;
  const dx = e.clientX - drag.startClientX;
  const dy = e.clientY - drag.startClientY;
  return Math.hypot(dx, dy) <= CONTEXT_CLICK_TOLERANCE_PX;
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
  const dxMm = (args.e.clientX - args.drag.startClientX) / cssScale / view.scale;
  const dyMm = (args.e.clientY - args.drag.startClientY) / cssScale / view.scale;
  return { panX: args.drag.startPanX + dxMm, panY: args.drag.startPanY + dyMm };
}

// Compute the next transform for a move/scale/rotate drag event. Pan
// drags never reach this function (the caller handles them before
// computing a scene point).
export function nextTransformForDrag(
  drag: Exclude<DragState, { kind: 'pan' | 'draw' | 'marquee' }>,
  obj: SceneObject,
  point: Vec2,
  e: { readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean },
  selectionAnchor?: SelectionAnchor,
): Transform {
  if (drag.kind === 'move') {
    return {
      ...obj.transform,
      x: drag.startTx + (point.x - drag.startScenePoint.x),
      y: drag.startTy + (point.y - drag.startScenePoint.y),
    };
  }
  if (drag.kind === 'scale') {
    const useCenterAnchor = e.ctrlKey || e.metaKey;
    return scaleObjectByHandleDrag({
      object: obj,
      handle: drag.handle,
      dragTo: point,
      lockAspect: !e.shiftKey,
      fromCenter: useCenterAnchor,
      ...(useCenterAnchor || selectionAnchor === undefined ? {} : { anchor: selectionAnchor }),
    });
  }
  return rotateObjectByDrag({
    object: obj,
    dragTo: point,
    snap: e.shiftKey,
    ...(selectionAnchor === undefined ? {} : { anchor: selectionAnchor }),
  });
}

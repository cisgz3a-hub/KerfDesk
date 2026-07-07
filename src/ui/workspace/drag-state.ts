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
import type { PathNodeDragState } from './path-node-drag';
import {
  hitRotateHandle,
  hitSelectionRotateHandle,
  objectRotateAnchor,
  pointerAngleDeg,
  rotateObjectByDrag,
  rotateObjectRelative,
  selectionRotateAnchor,
} from './rotate-handle';
import { canvasMouseToScene, computeView, pxToMmForCanvas } from './view-transform';

export type MoveStartTransform = {
  readonly id: string;
  readonly transform: Transform;
};

export type DragState =
  | {
      readonly kind: 'move';
      readonly objectId: string;
      readonly startScenePoint: Vec2;
      readonly startTx: number;
      readonly startTy: number;
      readonly selectionStartTransforms?: ReadonlyArray<MoveStartTransform>;
    }
  | {
      readonly kind: 'scale';
      readonly objectId: string;
      readonly handle: HandleKind;
    }
  | {
      readonly kind: 'rotate';
      readonly objectId: string;
      readonly selectionStartTransforms?: ReadonlyArray<MoveStartTransform>;
      readonly rotateAnchor?: Vec2;
      readonly startPointerAngleDeg?: number;
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
      readonly shape: 'rect' | 'ellipse' | 'polygon' | 'star';
      readonly startScenePoint: Vec2;
    }
  | {
      readonly kind: 'marquee';
      readonly startScenePoint: Vec2;
      readonly additive: boolean;
    }
  | {
      readonly kind: 'measure';
      readonly startScenePoint: Vec2;
    }
  | PathNodeDragState;

// Decide what kind of drag a mouse-down on `point` initiates, based on the
// selected object's handle layout. Returns null if the click missed all
// handles (caller falls through to body hit-test).
export function pickHandleDrag(args: {
  readonly selectedObj: SceneObject;
  readonly point: Vec2;
  readonly pxToMm: number;
  readonly selectionAnchor?: SelectionAnchor;
}): DragState | null {
  const { selectedObj, point, pxToMm } = args;
  if (hitRotateHandle(selectedObj, point, pxToMm)) {
    // Capture the pivot, the pointer angle, and the object's transform AT the
    // grab so the rotate is relative to where the drag started — no jump on a
    // pre-rotated object (audit C2).
    const anchor = objectRotateAnchor(selectedObj, args.selectionAnchor ?? 'c');
    return {
      kind: 'rotate',
      objectId: selectedObj.id,
      rotateAnchor: anchor,
      startPointerAngleDeg: pointerAngleDeg(anchor, point),
      selectionStartTransforms: [{ id: selectedObj.id, transform: { ...selectedObj.transform } }],
    };
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
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly viewState: { readonly zoomFactor: number; readonly panX: number; readonly panY: number };
  readonly onShiftClick: (id: string) => void;
  readonly onPlainClick: (id: string | null) => void;
  // 9-dot rotate/scale pivot from the numeric-edits bar; defaults to center.
  readonly selectionAnchor?: SelectionAnchor;
}): DragState | null {
  const {
    e,
    ref,
    project,
    selectedObjectId,
    additionalSelectedIds,
    viewState,
    onShiftClick,
    onPlainClick,
  } = args;
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
  const selectedIds = selectedObjectIds(selectedObjectId, additionalSelectedIds);
  const selectedObjects = selectedObjectsForIds(project.scene.objects, selectedIds);
  const selectedObj = project.scene.objects.find((o) => o.id === selectedObjectId);
  const pxToMm = pxToMmForCanvas(ref.current, project, viewState);
  const selectionRotateDrag = pickSelectionRotateDrag({
    selectedObjects,
    selectedObjectId,
    point,
    pxToMm,
  });
  if (selectionRotateDrag !== null) return selectionRotateDrag;
  if (selectedObj !== undefined && selectedObjects.length <= 1) {
    const handleDrag = pickHandleDrag({
      selectedObj,
      point,
      pxToMm,
      ...(args.selectionAnchor === undefined ? {} : { selectionAnchor: args.selectionAnchor }),
    });
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
  const obj = project.scene.objects.find((o) => o.id === hitId);
  if (obj === undefined) return null;
  const dragExistingSelection = selectedIds.includes(hitId);
  const moveIds = dragExistingSelection ? selectedIds : [hitId];
  if (!dragExistingSelection) onPlainClick(hitId);
  return {
    kind: 'move',
    objectId: hitId,
    startScenePoint: point,
    startTx: obj.transform.x,
    startTy: obj.transform.y,
    selectionStartTransforms: moveStartTransforms(project.scene.objects, moveIds),
  };
}

function selectedObjectIds(
  selectedObjectId: string | null,
  additionalSelectedIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  const ids = selectedObjectId === null ? [] : [selectedObjectId];
  return [...ids, ...additionalSelectedIds].filter(uniqueId);
}

function selectedObjectsForIds(
  objects: ReadonlyArray<SceneObject>,
  ids: ReadonlyArray<string>,
): ReadonlyArray<SceneObject> {
  return ids
    .map((id) => objects.find((object) => object.id === id))
    .filter((object): object is SceneObject => object !== undefined);
}

function pickSelectionRotateDrag(args: {
  readonly selectedObjects: ReadonlyArray<SceneObject>;
  readonly selectedObjectId: string | null;
  readonly point: Vec2;
  readonly pxToMm: number;
}): Extract<DragState, { kind: 'rotate' }> | null {
  if (args.selectedObjects.length <= 1) return null;
  if (!hitSelectionRotateHandle(args.selectedObjects, args.point, args.pxToMm)) return null;
  const anchor = selectionRotateAnchor(args.selectedObjects);
  const objectId = args.selectedObjectId ?? args.selectedObjects[0]?.id;
  if (anchor === null || objectId === undefined) return null;
  return {
    kind: 'rotate',
    objectId,
    selectionStartTransforms: args.selectedObjects.map((object) => ({
      id: object.id,
      transform: { ...object.transform },
    })),
    rotateAnchor: anchor,
    startPointerAngleDeg: pointerAngleDeg(anchor, args.point),
  };
}

function uniqueId(id: string, index: number, ids: ReadonlyArray<string>): boolean {
  return ids.indexOf(id) === index;
}

function moveStartTransforms(
  objects: ReadonlyArray<SceneObject>,
  ids: ReadonlyArray<string>,
): ReadonlyArray<MoveStartTransform> {
  return ids
    .map((id) => objects.find((object) => object.id === id))
    .filter((object): object is SceneObject => object !== undefined)
    .map((object) => ({ id: object.id, transform: { ...object.transform } }));
}

export function transformUpdatesForMoveDrag(
  drag: Extract<DragState, { kind: 'move' }>,
  draggedTransform: Transform,
): ReadonlyArray<MoveStartTransform> {
  const starts = drag.selectionStartTransforms;
  if (starts === undefined || starts.length <= 1) {
    return [{ id: drag.objectId, transform: draggedTransform }];
  }
  const draggedStart = starts.find((entry) => entry.id === drag.objectId);
  if (draggedStart === undefined) return [{ id: drag.objectId, transform: draggedTransform }];
  const dx = draggedTransform.x - draggedStart.transform.x;
  const dy = draggedTransform.y - draggedStart.transform.y;
  return starts.map((entry) => ({
    id: entry.id,
    transform:
      entry.id === drag.objectId
        ? draggedTransform
        : { ...entry.transform, x: entry.transform.x + dx, y: entry.transform.y + dy },
  }));
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

export function isRightButtonDoubleClick(e: {
  readonly button: number;
  readonly detail: number;
}): boolean {
  return e.button === RIGHT_BUTTON && e.detail >= 2;
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
  if (!Number.isFinite(cssScale) || cssScale <= 0) {
    return { panX: args.drag.startPanX, panY: args.drag.startPanY };
  }
  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    return { panX: args.drag.startPanX, panY: args.drag.startPanY };
  }
  const dxMm = (args.e.clientX - args.drag.startClientX) / cssScale / view.scale;
  const dyMm = (args.e.clientY - args.drag.startClientY) / cssScale / view.scale;
  return { panX: args.drag.startPanX + dxMm, panY: args.drag.startPanY + dyMm };
}

// Compute the next transform for a move/scale/rotate drag event. Pan
// drags never reach this function (the caller handles them before
// computing a scene point).
export function nextTransformForDrag(
  drag: Exclude<DragState, { kind: 'pan' | 'draw' | 'marquee' | 'measure' }>,
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
  // Relative rotate when the grab reference was captured (audit C2): apply the
  // pointer-angle delta since grab to the grab-time transform. The legacy
  // absolute path stays as a fallback for callers/tests that don't pass one.
  // (path-node drags never reach here — they're handled in the mouse layer.)
  if (drag.kind === 'rotate') {
    const start = drag.selectionStartTransforms?.[0];
    if (
      drag.rotateAnchor !== undefined &&
      drag.startPointerAngleDeg !== undefined &&
      start !== undefined
    ) {
      return rotateObjectRelative({
        startTransform: start.transform,
        anchor: drag.rotateAnchor,
        startPointerAngleDeg: drag.startPointerAngleDeg,
        dragTo: point,
        snap: e.shiftKey,
      });
    }
  }
  return rotateObjectByDrag({
    object: obj,
    dragTo: point,
    snap: e.shiftKey,
    ...(selectionAnchor === undefined ? {} : { anchor: selectionAnchor }),
  });
}

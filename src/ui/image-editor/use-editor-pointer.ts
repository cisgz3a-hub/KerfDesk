// Pointer handling for the Image Studio canvas (ADR-242): tool drags advance
// the pure EditorDrag union; completion dispatches exactly one store commit
// per gesture (the capture->mutate->push history protocol lives in the
// session ops). Wheel zooms about the cursor; middle-drag pans.

import { useCallback, useRef, useState } from 'react';
import { ellipseSelection, polygonSelection, rectSelection } from '../../core/image-select';
import {
  advanceDrag,
  beginDrag,
  booleanFromModifiers,
  CLICK_TOLERANCE_PX,
  dragRect,
  IDLE_DRAG,
  marqueeRect,
  type DragModifiers,
  type EditorDrag,
} from './editor-drag';
import { useAdjustDialogStore } from './adjust-dialog-store';
import { compositeSession } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';
import { useQuickMaskStore } from './quick-mask-store';
import type { EditorView } from './image-editor-types';
import { canvasToDoc } from './editor-canvas-draw';
import { dragTransform, hitTransformHandle } from './editor-transform';

const ZOOM_STEP = 1.1;
const MIN_SCALE = 0.05;
const MAX_SCALE = 64;

type PointerApi = {
  readonly drag: EditorDrag;
  readonly onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onDoubleClick: () => void;
  readonly onWheel: (e: React.WheelEvent<HTMLCanvasElement>) => void;
  readonly cancelDrag: () => void;
};

/**
 * Canvas double-click: commit the active modal state (transform, then crop —
 * the Photoshop grammar), otherwise return to the default Brush tool (the
 * maintainer's "unclick the tool" convention, same step Esc takes).
 */
export function canvasDoubleClickAction(): void {
  const store = useImageEditorStore.getState();
  if (useAdjustDialogStore.getState().dialog !== null) return;
  if (store.transform !== null) {
    store.commitTransform();
    return;
  }
  if (store.pendingCrop !== null) {
    store.commitPendingCrop();
    return;
  }
  // Otherwise "release" to a clean state: drop any selection (the marching
  // ants a wand/marquee left) AND return to the Brush. One gesture clears
  // both what a tool did and the tool itself (maintainer's convention).
  if (store.session?.selection != null) store.select(null);
  if (store.tool.kind !== 'brush') store.setTool({ kind: 'brush' });
}

export function useEditorPointer(
  view: EditorView,
  setView: (view: EditorView) => void,
): PointerApi {
  const [drag, setDrag] = useState<EditorDrag>(IDLE_DRAG);
  const dragRef = useRef(drag);
  const update = useCallback((next: EditorDrag) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const docPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return canvasToDoc(view, e.clientX - rect.left, e.clientY - rect.top);
    },
    [view],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => pointerDown(e, view.scale, update, docPoint(e)),
    [docPoint, update, view.scale],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const current = dragRef.current;
      if (current.kind === 'idle') return;
      if (current.kind === 'pan') {
        setView({
          scale: view.scale,
          panX: view.panX + e.clientX - current.lastClientX,
          panY: view.panY + e.clientY - current.lastClientY,
        });
        update({ kind: 'pan', lastClientX: e.clientX, lastClientY: e.clientY });
        return;
      }
      if (current.kind === 'transform-drag') {
        moveTransformDrag(current, docPoint(e), e.shiftKey);
        return;
      }
      update(
        advanceDrag(
          current,
          docPoint(e),
          { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey },
          useImageEditorStore.getState().isSpacePanning,
        ),
      );
    },
    [docPoint, setView, update, view],
  );

  const onPointerUp = useCallback(() => {
    const finished = dragRef.current;
    update(IDLE_DRAG);
    completeDrag(finished);
  }, [update]);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => zoomAtPointer(view, setView, e),
    [setView, view],
  );

  const cancelDrag = useCallback(() => update(IDLE_DRAG), [update]);

  return {
    drag,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick: canvasDoubleClickAction,
    onWheel,
    cancelDrag,
  };
}

function pointerDown(
  e: React.PointerEvent<HTMLCanvasElement>,
  viewScale: number,
  update: (drag: EditorDrag) => void,
  point: { x: number; y: number },
): void {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // A detached canvas or an already-dead pointer id must not kill the
    // gesture — capture is an optimization, not a requirement.
  }
  const state = useImageEditorStore.getState();
  // Middle button or held Spacebar = Hand pan (Photoshop convention).
  if (e.button === 1 || state.isSpacePanning) {
    update({ kind: 'pan', lastClientX: e.clientX, lastClientY: e.clientY });
    return;
  }
  if (e.button !== 0) return;
  // An open adjustment dialog parks the tools: its preview buffer must
  // track a stable document (pan/zoom/wheel stay live above).
  if (useAdjustDialogStore.getState().dialog !== null) return;
  const transformDrag = beginTransformDrag(state, point, viewScale);
  if (transformDrag !== null) {
    update(transformDrag);
    return;
  }
  startToolDrag(e, point, update);
}

// Wheel zooms about the pointer (matches the workspace canvas; Alt+wheel is
// identical — both zoom, per the maintainer's app convention).
function zoomAtPointer(
  view: EditorView,
  setView: (view: EditorView) => void,
  e: React.WheelEvent<HTMLCanvasElement>,
): void {
  const rect = e.currentTarget.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  setView({
    scale,
    panX: cx - (cx - view.panX) * ratio,
    panY: cy - (cy - view.panY) * ratio,
  });
}

// An active Ctrl+T session grabs every left drag until Enter/Esc.
function beginTransformDrag(
  state: ReturnType<typeof useImageEditorStore.getState>,
  point: { x: number; y: number },
  viewScale: number,
): EditorDrag | null {
  const transform = state.transform;
  if (transform === null) return null;
  const handle = hitTransformHandle(transform.floating.rect, transform.affine, point, viewScale);
  return { kind: 'transform-drag', handle, startAffine: transform.affine, from: point };
}

function moveTransformDrag(
  current: Extract<EditorDrag, { kind: 'transform-drag' }>,
  point: { x: number; y: number },
  shift: boolean,
): void {
  const store = useImageEditorStore.getState();
  if (store.transform === null) return;
  store.updateTransformAffine(
    dragTransform(
      current.startAffine,
      store.transform.floating.rect,
      current.handle,
      current.from,
      point,
      shift,
    ),
  );
}

function isPaintToolKind(
  kind: ReturnType<typeof useImageEditorStore.getState>['tool']['kind'],
): boolean {
  return kind === 'brush' || kind === 'pencil' || kind === 'eraser' || kind === 'line';
}

// Left-button tool dispatch: Alt-click eyedropper inside paint tools, wand
// click with boolean modifiers, otherwise begin the pure drag state.
function startToolDrag(
  e: React.PointerEvent<HTMLCanvasElement>,
  point: { x: number; y: number },
  update: (drag: EditorDrag) => void,
): void {
  const state = useImageEditorStore.getState();
  const isPaintTool = isPaintToolKind(state.tool.kind);
  // Quick Mask parks everything except painting (which routes to the mask).
  if (useQuickMaskStore.getState().rubylith !== null && !isPaintTool) return;
  if (isPaintTool && e.altKey) {
    sampleForeground(point.x, point.y);
    return;
  }
  const modifiers: DragModifiers = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey };
  const selection = state.session?.selection ?? null;
  if (state.tool.kind === 'wand') {
    state.wandAt(
      point.x,
      point.y,
      booleanFromModifiers(modifiers, selection !== null) ?? undefined,
    );
    return;
  }
  const insideSelection =
    selection !== null &&
    (selection.alpha[Math.floor(point.y) * selection.width + Math.floor(point.x)] ?? 0) > 0;
  update(beginDrag(state.tool, point, modifiers, selection !== null, insideSelection));
}

// Alt-click eyedropper: sample the VISIBLE pixel under the cursor (the layer
// composite, ADR-245) into the foreground color.
function sampleForeground(x: number, y: number): void {
  const store = useImageEditorStore.getState();
  const session = store.session;
  if (session === null) return;
  const doc = compositeSession(session);
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= doc.width || py >= doc.height) return;
  const base = (py * doc.width + px) * 4;
  store.setForeground({
    r: doc.data[base] ?? 0,
    g: doc.data[base + 1] ?? 0,
    b: doc.data[base + 2] ?? 0,
  });
}

function completeDrag(drag: EditorDrag): void {
  const store = useImageEditorStore.getState();
  const doc = store.session?.doc;
  if (doc === undefined) return;
  // idle/pan finish nothing; a transform drag already updated the affine
  // live and its session stays active until Enter/Esc.
  if (drag.kind === 'idle' || drag.kind === 'pan' || drag.kind === 'transform-drag') return;
  completeActionDrag(store, doc, drag);
}

type ActionDrag = Exclude<EditorDrag, { kind: 'idle' | 'pan' | 'transform-drag' }>;

function completeActionDrag(
  store: ReturnType<typeof useImageEditorStore.getState>,
  doc: NonNullable<ReturnType<typeof useImageEditorStore.getState>['session']>['doc'],
  drag: ActionDrag,
): void {
  switch (drag.kind) {
    case 'paint':
      // An active Quick Mask consumes the stroke into the rubylith.
      if (useQuickMaskStore.getState().strokeInto(drag.points)) return;
      store.stroke(drag.points);
      return;
    case 'line':
      if (useQuickMaskStore.getState().lineInto(drag.from, drag.to, drag.shift)) return;
      completeLine(store, drag);
      return;
    case 'marquee':
      completeMarquee(drag, doc.width, doc.height);
      return;
    case 'crop-drag':
      completeCropDrag(store, drag);
      return;
    case 'lasso':
      completeLasso(store, drag, doc.width, doc.height);
      return;
    case 'move-outline':
      store.nudgeSelection(drag.to.x - drag.from.x, drag.to.y - drag.from.y, false);
      return;
    case 'move-selection':
      store.moveSelection(drag.to.x - drag.from.x, drag.to.y - drag.from.y);
      return;
  }
}

function completeLine(
  store: ReturnType<typeof useImageEditorStore.getState>,
  drag: Extract<EditorDrag, { kind: 'line' }>,
): void {
  store.line(drag.from, drag.to, drag.shift);
}

function completeLasso(
  store: ReturnType<typeof useImageEditorStore.getState>,
  drag: Extract<EditorDrag, { kind: 'lasso' }>,
  docWidth: number,
  docHeight: number,
): void {
  store.combineSelection(
    polygonSelection(docWidth, docHeight, drag.points),
    drag.booleanOverride ?? undefined,
  );
}

function completeCropDrag(
  store: ReturnType<typeof useImageEditorStore.getState>,
  drag: Extract<EditorDrag, { kind: 'crop-drag' }>,
): void {
  const rect = dragRect(drag);
  // A tiny drag is a click: keep any existing pending crop untouched.
  if (rect.width >= CLICK_TOLERANCE_PX && rect.height >= CLICK_TOLERANCE_PX) {
    store.setPendingCrop(rect);
  }
}

function completeMarquee(
  drag: Extract<EditorDrag, { kind: 'marquee' }>,
  docWidth: number,
  docHeight: number,
): void {
  const store = useImageEditorStore.getState();
  const rect = marqueeRect(drag);
  // A sub-tolerance replace-mode drag is a click: clear the selection.
  if (rect.width < CLICK_TOLERANCE_PX && rect.height < CLICK_TOLERANCE_PX) {
    if (drag.booleanOverride === null && store.selectionMode === 'replace') store.select(null);
    return;
  }
  store.combineSelection(
    drag.shape === 'ellipse'
      ? ellipseSelection(docWidth, docHeight, rect)
      : rectSelection(docWidth, docHeight, rect),
    drag.booleanOverride ?? undefined,
  );
}

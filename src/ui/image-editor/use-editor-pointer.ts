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
  IDLE_DRAG,
  marqueeRect,
  type DragModifiers,
  type EditorDrag,
} from './editor-drag';
import { useImageEditorStore } from './image-editor-store';
import type { EditorView } from './image-editor-types';
import { canvasToDoc } from './editor-canvas-draw';

const ZOOM_STEP = 1.1;
const MIN_SCALE = 0.05;
const MAX_SCALE = 64;

type PointerApi = {
  readonly drag: EditorDrag;
  readonly onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  readonly onWheel: (e: React.WheelEvent<HTMLCanvasElement>) => void;
  readonly cancelDrag: () => void;
};

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
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const state = useImageEditorStore.getState();
      // Middle button or held Spacebar = Hand pan (Photoshop convention).
      if (e.button === 1 || state.isSpacePanning) {
        update({ kind: 'pan', lastClientX: e.clientX, lastClientY: e.clientY });
        return;
      }
      if (e.button !== 0) return;
      startToolDrag(e, docPoint(e), update);
    },
    [docPoint, update],
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

  return { drag, onPointerDown, onPointerMove, onPointerUp, onWheel, cancelDrag };
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

// Left-button tool dispatch: Alt-click eyedropper inside paint tools, wand
// click with boolean modifiers, otherwise begin the pure drag state.
function startToolDrag(
  e: React.PointerEvent<HTMLCanvasElement>,
  point: { x: number; y: number },
  update: (drag: EditorDrag) => void,
): void {
  const state = useImageEditorStore.getState();
  const isPaintTool =
    state.tool.kind === 'brush' ||
    state.tool.kind === 'pencil' ||
    state.tool.kind === 'eraser' ||
    state.tool.kind === 'line';
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

// Alt-click eyedropper: sample the document pixel under the cursor into the
// foreground color.
function sampleForeground(x: number, y: number): void {
  const store = useImageEditorStore.getState();
  const doc = store.session?.doc;
  if (doc === undefined) return;
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
  switch (drag.kind) {
    case 'idle':
    case 'pan':
      return;
    case 'paint':
      store.stroke(drag.points);
      return;
    case 'line':
      store.line(drag.from, drag.to, drag.shift);
      return;
    case 'marquee':
      completeMarquee(drag, doc.width, doc.height);
      return;
    case 'lasso':
      store.combineSelection(
        polygonSelection(doc.width, doc.height, drag.points),
        drag.booleanOverride ?? undefined,
      );
      return;
    case 'move-outline':
      store.nudgeSelection(drag.to.x - drag.from.x, drag.to.y - drag.from.y, false);
      return;
    case 'move-selection':
      store.moveSelection(drag.to.x - drag.from.x, drag.to.y - drag.from.y);
      return;
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

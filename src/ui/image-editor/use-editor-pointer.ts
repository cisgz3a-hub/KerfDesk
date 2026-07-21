// Pointer handling for the Image Studio canvas (ADR-242): tool drags advance
// the pure EditorDrag union; completion dispatches exactly one store commit
// per gesture (the capture->mutate->push history protocol lives in the
// session ops). Wheel zooms about the cursor; middle-drag pans.

import { useCallback, useRef, useState } from 'react';
import { ellipseSelection, polygonSelection, rectSelection } from '../../core/image-select';
import {
  advanceDrag,
  beginDrag,
  CLICK_TOLERANCE_PX,
  IDLE_DRAG,
  marqueeRect,
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
      if (e.button === 1) {
        update({ kind: 'pan', lastClientX: e.clientX, lastClientY: e.clientY });
        return;
      }
      if (e.button !== 0) return;
      const state = useImageEditorStore.getState();
      const point = docPoint(e);
      if (state.tool.kind === 'wand') {
        state.wandAt(point.x, point.y);
        return;
      }
      update(beginDrag(state.tool, point, e.shiftKey, (state.session?.selection ?? null) !== null));
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
      update(advanceDrag(current, docPoint(e), e.shiftKey));
    },
    [docPoint, setView, update, view],
  );

  const onPointerUp = useCallback(() => {
    const finished = dragRef.current;
    update(IDLE_DRAG);
    completeDrag(finished);
  }, [update]);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
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
    },
    [setView, view],
  );

  const cancelDrag = useCallback(() => update(IDLE_DRAG), [update]);

  return { drag, onPointerDown, onPointerMove, onPointerUp, onWheel, cancelDrag };
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
      store.select(polygonSelection(doc.width, doc.height, drag.points));
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
  // A sub-tolerance drag is a click: clear the selection instead of
  // selecting a sliver.
  if (rect.width < CLICK_TOLERANCE_PX && rect.height < CLICK_TOLERANCE_PX) {
    store.select(null);
    return;
  }
  store.select(
    drag.ellipse
      ? ellipseSelection(docWidth, docHeight, rect)
      : rectSelection(docWidth, docHeight, rect),
  );
}

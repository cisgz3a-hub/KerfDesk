import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { canEdit, store, type View } from '../core/store';
import type { Point } from '../core/scene';
import { CANCEL_CANVAS_GESTURE, type Gesture } from './canvas-gesture-types';

const snapshot = () => {
  const state = store.get();
  return {
    revision: state.workspace?.revision,
    generation: state.connectionGeneration,
    tool: state.tool,
    view: state.view,
    mode: state.selectionMode,
    sheet: state.sheet,
    editable: canEdit(state),
  };
};

/** A gesture belongs to the exact document and camera where it began. */
export function useGestureLifecycle(
  gesture: MutableRefObject<Gesture | null>,
  pointers: RefObject<Map<number, Point>>,
  wrap: RefObject<HTMLDivElement>,
  clearMarquee: () => void,
) {
  const boundary = useRef<ReturnType<typeof snapshot> | null>(null);
  const cancel = useCallback(() => {
    const active = gesture.current;
    if (active === null) return false;
    gesture.current = null;
    boundary.current = null;
    const ids = [...(pointers.current?.keys() ?? [])];
    pointers.current?.clear();
    for (const id of ids)
      if (wrap.current?.hasPointerCapture(id)) wrap.current.releasePointerCapture(id);
    clearMarquee();
    store.set({
      preview: null,
      ...(active.kind === 'box' || active.kind === 'pen' ? { draft: null } : {}),
    });
    return true;
  }, [gesture, pointers, wrap, clearMarquee]);
  const valid = useCallback(() => {
    const before = boundary.current;
    if (before === null) return false;
    const now = snapshot();
    return (
      before.revision === now.revision &&
      before.generation === now.generation &&
      before.tool === now.tool &&
      before.view === now.view &&
      before.mode === now.mode &&
      before.sheet === now.sheet &&
      before.editable === now.editable
    );
  }, []);
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      if (gesture.current !== null && !valid()) cancel();
    });
    const onCancel = (event: Event) => {
      if (cancel()) event.preventDefault();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    window.addEventListener(CANCEL_CANVAS_GESTURE, onCancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('pagehide', cancel);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      unsubscribe();
      window.removeEventListener(CANCEL_CANVAS_GESTURE, onCancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pagehide', cancel);
      document.removeEventListener('visibilitychange', onHidden);
      cancel();
    };
  }, [cancel, gesture, valid]);
  return {
    cancel,
    valid,
    remember: () => {
      boundary.current = snapshot();
    },
    setView: (view: View) => {
      if (boundary.current !== null) boundary.current.view = view;
      store.set({ view });
    },
  };
}

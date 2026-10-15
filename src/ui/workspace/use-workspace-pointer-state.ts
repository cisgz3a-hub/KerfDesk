import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import type { DragState } from './drag-state';
import { clearOwnedPointerDrag } from './workspace-pointer-owner';
import { clearSnapFeedback } from './workspace-pointer-snap';

export function useWorkspacePointerState(ref: RefObject<HTMLCanvasElement | null>) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const activePointerId = useRef<number | null>(null);
  const cancelPending = useRef<() => void>(() => undefined);
  const documentEpoch = useStore((state) => state.projectDocumentEpoch);
  const clearDrag = useCallback(() => {
    cancelPending.current();
    clearOwnedPointerDrag({ canvas: ref.current, activePointerId, setDrag });
  }, [ref]);
  const previousEpoch = useRef(documentEpoch);
  useLayoutEffect(() => {
    if (previousEpoch.current === documentEpoch) return;
    previousEpoch.current = documentEpoch;
    // Replacement already owns the new project. Never roll it back through the
    // old interaction snapshot or move a reused object ID with a captured drag.
    clearDrag();
    useUiStore.setState({ selectionMarquee: null, measureDraft: null, draftShape: null });
    clearSnapFeedback();
    useStore.getState().setCursorMm(null);
  }, [clearDrag, documentEpoch]);
  return { drag, setDrag, activePointerId, cancelPending, documentEpoch, clearDrag };
}

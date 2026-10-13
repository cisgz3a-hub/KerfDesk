import { useEffect } from 'react';
import { useUiStore } from '../state/ui-store';
import type { DragState } from './drag-state';
import { cancelWorkspaceDrag, type WorkspaceDragCancellationDeps } from './workspace-drag-cancel';

/** Leaving path editing cancels only its unfinished drag, preserving completed edits. */
export function useToolChangeCancelsDrag(
  drag: DragState | null,
  deps: WorkspaceDragCancellationDeps,
  clearDrag: () => void,
): void {
  const { cancelInteraction, setSelectionMarquee, setMeasureDraft, setDraftShape, setCursorMm } =
    deps;
  const { setSnapGuides } = deps;
  useEffect(() => {
    if (drag === null) return undefined;
    // Subscribe directly: cancel before a queued pointer event can apply another
    // edit after Done, a toolbar toggle, or a switch to another tool.
    return useUiStore.subscribe((state, previous) => {
      const leaving = previous.toolMode.kind;
      if (leaving !== 'node' && leaving !== 'trace-parts') return;
      if (state.toolMode.kind === leaving) return;
      cancelWorkspaceDrag(drag, {
        cancelInteraction,
        setSelectionMarquee,
        setMeasureDraft,
        setDraftShape,
        setCursorMm,
        setSnapGuides,
      });
      clearDrag();
    });
  }, [
    drag,
    cancelInteraction,
    setSelectionMarquee,
    setMeasureDraft,
    setDraftShape,
    setCursorMm,
    setSnapGuides,
    clearDrag,
  ]);
}

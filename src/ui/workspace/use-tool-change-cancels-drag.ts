import { useEffect } from 'react';
import { useUiStore, type ToolMode } from '../state/ui-store';
import type { DragState } from './drag-state';
import { cancelWorkspaceDrag, type WorkspaceDragCancellationDeps } from './workspace-drag-cancel';

/**
 * Leaving path editing cancels only its unfinished drag, preserving completed
 * edits. Leaving the tool of a live draw or measure drag ends that drag too:
 * Esc returns to Select (ADR-051), and the release that followed used to draw
 * the shape whose preview Esc had just cleared.
 */
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
      if (state.toolMode === previous.toolMode) return;
      if (!leavesDragTool(drag, previous.toolMode, state.toolMode)) return;
      cancelWorkspaceDrag(drag, {
        // A draw or measure drag owns no snapshot, and committing a shape
        // returns to Select from inside the drag: leave any other one alone.
        cancelInteraction: ownsSnapshot(drag) ? cancelInteraction : () => undefined,
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

function ownsSnapshot(drag: DragState): boolean {
  return drag.kind !== 'draw' && drag.kind !== 'measure';
}

function leavesDragTool(drag: DragState, leaving: ToolMode, next: ToolMode): boolean {
  if (drag.kind === 'draw') return next.kind !== 'draw' || next.shape !== drag.shape;
  if (drag.kind === 'measure') return next.kind !== 'measure';
  if (leaving.kind !== 'node' && leaving.kind !== 'trace-parts') return false;
  return next.kind !== leaving.kind;
}

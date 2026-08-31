import { useUiStore } from '../state/ui-store';
import type { DragState } from './drag-state';
import type { useWorkspaceDragDeps } from './workspace-drag-deps';

export type WorkspaceDragCancellationDeps = Pick<
  ReturnType<typeof useWorkspaceDragDeps>,
  | 'cancelInteraction'
  | 'setSelectionMarquee'
  | 'setMeasureDraft'
  | 'setDraftShape'
  | 'setCursorMm'
  | 'setSnapGuides'
>;

/** Roll every live drag surface back without creating an undo entry. */
export function cancelWorkspaceDrag(
  drag: DragState | null,
  deps: WorkspaceDragCancellationDeps,
): void {
  deps.cancelInteraction();
  deps.setSelectionMarquee(null);
  deps.setMeasureDraft(null);
  deps.setDraftShape(null);
  deps.setCursorMm(null);
  deps.setSnapGuides([]);
  if (drag?.kind === 'pan') {
    useUiStore.getState().setPan(drag.startPanX, drag.startPanY);
  }
}

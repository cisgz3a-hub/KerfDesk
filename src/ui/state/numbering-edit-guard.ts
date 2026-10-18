// Canvas numbering (Run order → Number on canvas) holds one interaction open
// for its whole session, and its Cancel restores the snapshot taken when it
// began. An ordinary edit made meanwhile (Delete, a nudge, Paste, a menu or
// Ctrl+K command) would land inside that interaction and Cancel would silently
// throw it away, so while numbering is open every edit that would add or
// rewrite an Undo step is refused, and Undo/Redo with it. Numbering's own order
// changes and selection push no Undo step, and the interaction's begin, end and
// cancel use the store's unguarded setter.

import type { AppState } from './store';
import { useToastStore } from './toast-store';
import { useUiStore } from './ui-store';
import { saveUndoStepName } from './undo-step-names';

type Patch = AppState | Partial<AppState>;
type Setter = (patch: Patch | ((state: AppState) => Patch)) => void;

export const NUMBERING_EDIT_REFUSED_MESSAGE =
  'Run numbering is open. Click Done or Cancel in the Run order panel, then make your edit.';

export function numberingEditGuardSetter(set: Setter): Setter {
  return (update) =>
    set((state) => {
      if (!numberingOwnsInteraction(state)) {
        return typeof update === 'function' ? update(state) : update;
      }
      const restoreUndoName = saveUndoStepName(state.project);
      const patch = typeof update === 'function' ? update(state) : update;
      if (!editsHistory(state, patch)) return patch;
      restoreUndoName();
      queueMicrotask(() =>
        useToastStore
          .getState()
          .pushToast(NUMBERING_EDIT_REFUSED_MESSAGE, 'warning', { key: 'artwork-numbering-edit' }),
      );
      return {};
    });
}

function numberingOwnsInteraction(state: AppState): boolean {
  return state.pendingUndo !== null && useUiStore.getState().artworkNumbering.kind === 'active';
}

// A document replacement (New, Open) retires numbering itself, so it passes.
function editsHistory(state: AppState, patch: Patch): boolean {
  if (
    patch.projectDocumentEpoch !== undefined &&
    patch.projectDocumentEpoch !== state.projectDocumentEpoch
  ) {
    return false;
  }
  return (
    (patch.undoStack !== undefined && patch.undoStack !== state.undoStack) ||
    (patch.redoStack !== undefined && patch.redoStack !== state.redoStack) ||
    (patch.pendingUndo !== undefined && patch.pendingUndo !== state.pendingUndo)
  );
}

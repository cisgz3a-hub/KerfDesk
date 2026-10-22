// Canvas numbering (Run order → Number on canvas) holds one interaction open
// for its whole session, and its Cancel restores the snapshot taken when it
// began. An ordinary edit made meanwhile (Delete, a nudge, Paste, a menu or
// Ctrl+K command) would land inside that interaction and Cancel would silently
// throw it away, so while numbering is open every edit that would add or
// rewrite an Undo step is refused, and Undo/Redo with it. History-free placement
// and scope edits are retained in the rollback snapshot: they can also follow
// an acknowledged machine-origin action. Numbering's own order and selection
// push no Undo step; interaction begin/end/cancel use the unguarded setter.

import type { AppState } from './store';
import { useToastStore } from './toast-store';
import { useUiStore } from './ui-store';
import { saveUndoStepName } from './undo-step-names';
import { projectWithCurrentJobSetup } from './project-job-setup';

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
      if (!editsHistory(state, patch)) return retainJobSetupInNumberingSnapshot(state, patch);
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

function retainJobSetupInNumberingSnapshot(state: AppState, patch: Patch): Patch {
  const snapshot = state.pendingUndo;
  const placementChanged =
    patch.jobPlacement !== undefined && patch.jobPlacement !== state.jobPlacement;
  const scopeChanged =
    patch.outputScopeSettings !== undefined &&
    patch.outputScopeSettings !== state.outputScopeSettings;
  if (snapshot === null || (!placementChanged && !scopeChanged)) return patch;
  // Cancel restores the old selection/order, but keeps deliberate job settings.
  // Rebuild its saved jobSetup using that old selection so both live fields and
  // project persistence agree after Cancel (or Undo of the completed numbering).
  const project = projectWithCurrentJobSetup({
    ...state,
    ...snapshot,
    jobPlacement: patch.jobPlacement ?? state.jobPlacement,
    outputScopeSettings: patch.outputScopeSettings ?? state.outputScopeSettings,
  });
  return { ...patch, pendingUndo: { ...snapshot, project, dirty: true } };
}

import type { Project } from '../../core/scene';
import { proFeaturesUnlocked, requestProFeature } from './edition';
import { newlyIntroducedProFeature } from './pro-operation-policy';
import { saveUndoStepName } from '../state/undo-step-names';

type ProjectEditState = {
  readonly project: Project;
  readonly projectDocumentEpoch?: number;
};
type Mutation<State> = State | Partial<State> | ((state: State) => State | Partial<State>);

/**
 * Guard authoring actions at their shared store mutation boundary. The patch is
 * kept out of the store until Pro is available; an unlock can never apply a
 * captured edit to a changed or newly opened project. History and machine/output
 * actions deliberately use their ordinary setters. Proposed undo labels and
 * commit notifications belong only to the edit that admission actually commits.
 */
export function proOperationMutationSetter<State extends ProjectEditState>(
  set: (update: (state: State) => State | Partial<State>) => void,
  get: () => State,
  featureForEdit = newlyIntroducedProFeature,
): (update: Mutation<State>, onCommitted?: () => void, isCurrent?: () => boolean) => boolean {
  return (update, onCommitted, isCurrent) => {
    if (isCurrent?.() === false) return false;
    const before = get();
    const restoreUndoName = saveUndoStepName(before.project);
    const patch = typeof update === 'function' ? update(before) : update;
    const feature =
      patch.project === undefined || proFeaturesUnlocked()
        ? null
        : featureForEdit(before.project, patch.project);
    if (feature === null) {
      set(() => patch);
      onCommitted?.();
      return true;
    }
    const commitUndoName = saveUndoStepName(before.project);
    restoreUndoName();
    let applied = false;
    let consumed = false;
    requestProFeature(feature, () => {
      if (consumed) return;
      consumed = true;
      let committed = false;
      set((current) => {
        if (
          current.project !== before.project ||
          current.projectDocumentEpoch !== before.projectDocumentEpoch ||
          isCurrent?.() === false
        )
          return {};
        commitUndoName();
        committed = true;
        applied = true;
        return patch;
      });
      if (committed) onCommitted?.();
    });
    return applied;
  };
}

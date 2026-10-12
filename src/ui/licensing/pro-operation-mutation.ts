import type { Project } from '../../core/scene';
import { proFeaturesUnlocked, requestProFeature } from './edition';
import { changedProArtworkFeature, newlyIntroducedProFeature } from './pro-operation-policy';
import { saveUndoStepName } from '../state/undo-step-names';

type ProjectEditState = {
  readonly project: Project;
  readonly projectDocumentEpoch?: number;
};
type Mutation<State> = State | Partial<State> | ((state: State) => State | Partial<State>);

/**
 * Free keeps the store's other edits (text, node and image edits) from changing
 * existing Pro artwork (ADR-592). A refused patch is not applied and the Pro
 * prompt explains why. History, document replacement and output never pass here.
 */
export function freeProArtworkSetter<State extends ProjectEditState>(
  set: (update: Mutation<State>) => void,
): (update: Mutation<State>) => void {
  return (update) =>
    set((state: State) => {
      const patch = typeof update === 'function' ? update(state) : update;
      if (
        patch.project === undefined ||
        patch.project === state.project ||
        (patch.projectDocumentEpoch !== undefined &&
          patch.projectDocumentEpoch !== state.projectDocumentEpoch) ||
        proFeaturesUnlocked()
      )
        return patch;
      const feature = changedProArtworkFeature(state.project, patch.project);
      if (feature === null) return patch;
      queueMicrotask(() => requestProFeature(feature));
      return {};
    });
}

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

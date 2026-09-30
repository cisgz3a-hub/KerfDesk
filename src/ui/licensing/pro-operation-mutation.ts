import type { Project } from '../../core/scene';
import { proFeaturesUnlocked, requestProFeature } from './edition';
import { newlyIntroducedProFeature } from './pro-operation-policy';

type ProjectEditState = {
  readonly project: Project;
  readonly projectDocumentEpoch?: number;
};
type Mutation<State> = State | Partial<State> | ((state: State) => State | Partial<State>);

/**
 * Guard authoring actions at their shared store mutation boundary. The patch is
 * kept out of the store until Pro is available; an unlock can never apply a
 * captured edit to a changed or newly opened project. History and machine/output
 * actions deliberately use their ordinary setters.
 */
export function proOperationMutationSetter<State extends ProjectEditState>(
  set: (update: (state: State) => State | Partial<State>) => void,
  get: () => State,
): (update: Mutation<State>) => boolean {
  return (update) => {
    const before = get();
    const patch = typeof update === 'function' ? update(before) : update;
    const feature =
      patch.project === undefined || proFeaturesUnlocked()
        ? null
        : newlyIntroducedProFeature(before.project, patch.project);
    if (feature === null) {
      set(() => patch);
      return true;
    }
    let applied = false;
    requestProFeature(feature, () => {
      set((current) => {
        if (
          current.project !== before.project ||
          current.projectDocumentEpoch !== before.projectDocumentEpoch
        )
          return {};
        applied = true;
        return patch;
      });
    });
    return applied;
  };
}

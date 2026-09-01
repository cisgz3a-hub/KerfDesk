import type { AppState } from './store';
import { saveTargetsShareDestination } from './project-save-write-coordinator';

type Setter = (
  update: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;
type Getter = () => AppState;

export function saveTrackingActions(
  set: Setter,
  get: Getter,
): Pick<AppState, 'markSaved' | 'markProjectSaveUncertain' | 'markLoaded'> {
  return {
    markSaved: (
      target,
      expectedProject,
      expectedProjectDocumentEpoch,
      expectedProjectSaveRequestEpoch,
    ) => {
      let savedCurrentProject = false;
      set((state) => {
        if (
          state.projectDocumentEpoch !== expectedProjectDocumentEpoch ||
          state.projectSaveRequestEpoch !== expectedProjectSaveRequestEpoch
        ) {
          return {};
        }
        savedCurrentProject = state.project === expectedProject;
        return {
          dirty: savedCurrentProject ? false : state.dirty,
          savedName: target.displayName,
          lastSaveTarget: target,
          projectSavedRequestEpoch: expectedProjectSaveRequestEpoch,
        };
      });
      return savedCurrentProject;
    },
    markProjectSaveUncertain: async (
      expectedProjectDocumentEpoch,
      expectedProjectSavedRequestEpoch,
      target,
    ) => {
      const before = get();
      const savedTarget = before.lastSaveTarget;
      if (
        before.projectDocumentEpoch !== expectedProjectDocumentEpoch ||
        before.projectSavedRequestEpoch !== expectedProjectSavedRequestEpoch ||
        savedTarget === null ||
        !(await saveTargetsShareDestination(savedTarget, target))
      ) {
        return false;
      }
      let markedUncertain = false;
      set((state) => {
        if (
          state.projectDocumentEpoch !== expectedProjectDocumentEpoch ||
          state.projectSavedRequestEpoch !== expectedProjectSavedRequestEpoch ||
          state.lastSaveTarget !== savedTarget
        ) {
          return {};
        }
        markedUncertain = true;
        return { dirty: true };
      });
      return markedUncertain;
    },
    markLoaded: (filename, options) =>
      set({
        dirty: options?.dirty ?? false,
        savedName: filename,
        lastSaveTarget: null,
        projectSavedRequestEpoch: null,
      }),
  };
}

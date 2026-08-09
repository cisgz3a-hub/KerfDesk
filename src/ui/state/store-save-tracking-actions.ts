import type { AppState } from './store';

type Setter = (
  update: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;

export function saveTrackingActions(set: Setter): Pick<AppState, 'markSaved' | 'markLoaded'> {
  return {
    markSaved: (target, expectedProject) => {
      let savedCurrentProject = false;
      set((state) => {
        savedCurrentProject = expectedProject === undefined || state.project === expectedProject;
        return {
          dirty: savedCurrentProject ? false : state.dirty,
          savedName: target.displayName,
          lastSaveTarget: target,
        };
      });
      return savedCurrentProject;
    },
    markLoaded: (filename, options) =>
      set({ dirty: options?.dirty ?? false, savedName: filename, lastSaveTarget: null }),
  };
}

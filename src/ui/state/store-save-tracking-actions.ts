import type { Project } from '../../core/scene';
import type { SaveTarget } from '../../platform/types';
import type { AppState } from './store';
import { saveTargetsShareDestination } from './project-save-write-coordinator';

/** How a loaded document starts: unsaved, and where Save writes. Open sets the
 * opened KerfDesk file when the platform can write it back (ADR-550). */
export type MarkLoadedOptions = {
  readonly dirty?: boolean;
  readonly saveTarget?: SaveTarget;
};

export type ProjectSaveRestoration = {
  readonly expectedProject: Project;
  readonly completed: Promise<boolean>;
  readonly onRestored?: () => void;
};

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
    markProjectSaveUncertain: createProjectSaveUncertaintyAction(set, get),
    markLoaded: (filename, options) =>
      set({
        dirty: options?.dirty ?? false,
        savedName: filename,
        // Save writes over the KerfDesk project just opened (ADR-550).
        lastSaveTarget: options?.saveTarget ?? null,
        projectSavedRequestEpoch: null,
      }),
  };
}

function ownsSavedProject(
  state: AppState,
  documentEpoch: number,
  savedRequestEpoch: number,
  target: SaveTarget,
): boolean {
  return (
    state.projectDocumentEpoch === documentEpoch &&
    state.projectSavedRequestEpoch === savedRequestEpoch &&
    state.lastSaveTarget === target
  );
}

function createProjectSaveUncertaintyAction(
  set: Setter,
  get: Getter,
): AppState['markProjectSaveUncertain'] {
  let nextUncertainty = 0;
  let latestUncertainty = 0;
  return async (documentEpoch, savedRequestEpoch, target, restoration) => {
    const before = get();
    const savedTarget = before.lastSaveTarget;
    const token = ++nextUncertainty;
    if (
      savedTarget === null ||
      !ownsSavedProject(before, documentEpoch, savedRequestEpoch, savedTarget) ||
      !(await saveTargetsShareDestination(savedTarget, target))
    )
      return false;
    let markedUncertain = false;
    set((state) => {
      if (
        token < latestUncertainty ||
        !ownsSavedProject(state, documentEpoch, savedRequestEpoch, savedTarget)
      )
        return {};
      latestUncertainty = token;
      markedUncertain = true;
      return { dirty: true };
    });
    if (markedUncertain && restoration !== undefined) {
      void restoration.completed
        .then((restored) => {
          if (!restored) return;
          let markedRestored = false;
          set((state) => {
            if (
              latestUncertainty !== token ||
              state.project !== restoration.expectedProject ||
              !ownsSavedProject(state, documentEpoch, savedRequestEpoch, savedTarget)
            )
              return {};
            markedRestored = true;
            return { dirty: false };
          });
          if (markedRestored) restoration.onRestored?.();
        })
        .catch(() => {
          // Failed or abandoned restoration keeps recovery armed.
        });
    }
    return markedUncertain;
  };
}

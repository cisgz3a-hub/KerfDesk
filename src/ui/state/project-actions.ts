import { createProject, machineKindOf, type Project } from '../../core/scene';
import { currentMaterialLibraryState } from './material-library-actions';
import { resolveProjectMachineCapability } from './project-machine-capability';
import { currentSavedLibrariesState } from './saved-libraries-actions';
import type { AppState } from './store';

type ProjectActionSet = (
  fn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;
type ProjectActionGet = () => AppState;
type InitialStateFactory = (project?: Project) => Partial<AppState>;

export function projectActions(
  set: ProjectActionSet,
  get: ProjectActionGet,
  initialState: InitialStateFactory,
): Pick<AppState, 'setProject' | 'newProject'> {
  return {
    setProject: (project) => {
      const current = get();
      const resolution = resolveProjectMachineCapability(project, current.cncLibrary.customTools);
      set((state) => ({
        ...initialState(resolution.project),
        ...retainedApplicationState(state),
        cachedCncMachine: resolution.cachedCncMachine,
        dirty: resolution.loadResult.kind === 'capability-repaired',
      }));
      return resolution.loadResult;
    },
    newProject: () =>
      set((state) => {
        const blankProject = createProject(state.project.device);
        const project = resolveProjectMachineCapability(
          blankProject,
          state.cncLibrary.customTools,
          machineKindOf(state.project.machine),
        ).project;
        return {
          ...initialState(project),
          // Machine profiles and libraries are app-level. New resets the job,
          // but keeps the configured hardware contract and reusable libraries.
          ...retainedApplicationState(state),
        };
      }),
  };
}

function retainedApplicationState(
  state: AppState,
): Pick<AppState, 'layerDefaults' | 'cncLibrary'> &
  ReturnType<typeof currentMaterialLibraryState> &
  ReturnType<typeof currentSavedLibrariesState> {
  return {
    ...currentMaterialLibraryState(state),
    ...currentSavedLibrariesState(state),
    layerDefaults: state.layerDefaults,
    cncLibrary: state.cncLibrary,
  };
}

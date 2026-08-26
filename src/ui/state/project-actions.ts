import { createProject, machineKindOf, type Project } from '../../core/scene';
import { loneSelectableArtworkId } from './lone-selectable-artwork';
import { currentMaterialLibraryState } from './material-library-actions';
import {
  resolveProjectMachineCapability,
  type ProjectMachineCapabilityLoadResult,
} from './project-machine-capability';
import { currentSavedLibrariesState } from './saved-libraries-actions';
import type { AppState } from './store';
import {
  canonicalizeOpenedProjectBed,
  type ProjectBedReconciliationNotice,
} from './project-bed-reconciliation';

type ProjectActionSet = (
  fn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;
type ProjectActionGet = () => AppState;
type InitialStateFactory = (project?: Project) => Partial<AppState>;

export type ProjectActions = {
  readonly setProject: (project: Project) => ProjectMachineCapabilityLoadResult;
  readonly newProject: () => void;
  readonly acceptOpenedProjectMachine: () => void;
  readonly keepCurrentMachineForOpenedProject: () => void;
};

export function projectActions(
  set: ProjectActionSet,
  get: ProjectActionGet,
  initialState: InitialStateFactory,
): ProjectActions {
  return {
    setProject: (project) => {
      const current = get();
      const resolution = resolveProjectMachineCapability(project, current.cncLibrary.customTools);
      const bedResolution = canonicalizeOpenedProjectBed(resolution.project, current.project);
      set((state) => ({
        ...initialState(bedResolution.project),
        ...retainedApplicationState(state),
        projectDocumentEpoch: state.projectDocumentEpoch + 1,
        cachedCncMachine: resolution.cachedCncMachine,
        projectBedReconciliation: bedResolution.notice,
        dirty: bedResolution.notice?.workspaceMismatch === true,
      }));
      const loneArtworkId = loneSelectableArtworkId(bedResolution.project.scene);
      if (loneArtworkId !== null && get().selectedObjectId === null)
        get().selectObject(loneArtworkId);
      return bedResolution.notice?.workspaceMismatch === true
        ? { ...resolution.loadResult, projectBedReconciled: true }
        : resolution.loadResult;
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
          projectDocumentEpoch: state.projectDocumentEpoch + 1,
          projectBedReconciliation: null,
        };
      }),
    acceptOpenedProjectMachine: () => set({ projectBedReconciliation: null }),
    keepCurrentMachineForOpenedProject: () =>
      set((state) => keepCurrentMachinePatch(state, state.projectBedReconciliation)),
  };
}

function keepCurrentMachinePatch(
  state: AppState,
  notice: ProjectBedReconciliationNotice | null,
): Partial<AppState> {
  if (notice === null) return {};
  const { machine: _openedMachine, ...projectWithoutMachine } = state.project;
  void _openedMachine;
  const project: Project = {
    ...projectWithoutMachine,
    device: notice.previousDevice,
    workspace: {
      ...state.project.workspace,
      width: notice.previousDevice.bedWidth,
      height: notice.previousDevice.bedHeight,
    },
    ...(notice.previousMachine === undefined ? {} : { machine: notice.previousMachine }),
  };
  return { project, projectBedReconciliation: null, dirty: true };
}

function retainedApplicationState(
  state: AppState,
): Pick<AppState, 'layerDefaults' | 'cncLibrary' | 'cncLiveCaps'> &
  ReturnType<typeof currentMaterialLibraryState> &
  ReturnType<typeof currentSavedLibrariesState> {
  return {
    ...currentMaterialLibraryState(state),
    ...currentSavedLibrariesState(state),
    layerDefaults: state.layerDefaults,
    cncLibrary: state.cncLibrary,
    cncLiveCaps: state.cncLiveCaps,
  };
}

import {
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  machineKindOf,
  type CncMachineConfig,
  type Project,
} from '../../core/scene';
import { cncParamsWithOwnFeeds } from '../../core/cnc/cnc-head-feeds';
import { cncMachineWithReusableTools } from './machine-actions';
import { loneSelectableArtworkId } from './lone-selectable-artwork';
import { currentMaterialLibraryState } from './material-library-actions';
import { modeSwitchState } from './mode-switch-settings';
import { projectWithParkedCnc } from './parked-cnc-machine';
import {
  resolveProjectMachineCapability,
  type ProjectMachineCapabilityLoadResult,
} from './project-machine-capability';
import { currentSavedLibrariesState } from './saved-libraries-actions';
import { preserveBrowserProProject } from './pending-pro-project';
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
  readonly claimProjectOpenRequest: () => number;
  readonly claimProjectSaveRequest: () => number;
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
      const preserved = preserveBrowserProProject(project);
      if (preserved !== null) return { kind: 'desktop-required', features: preserved.features };
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
        // Accepted older CNC files can have no device mirror, or an older one.
        // Carry only CNC hardware into the fresh job seed, including when the
        // operator currently has Laser selected. Do not carry the parked job.
        const activeMachine = state.project.machine;
        const cncHardware =
          activeMachine?.kind === 'cnc' ? activeMachine : state.project.parkedCncMachine;
        const device =
          cncHardware !== undefined
            ? { ...state.project.device, cncSubProfile: { ...cncHardware.params } }
            : state.project.device;
        const blankProject = createProject(device);
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
    claimProjectOpenRequest: () => {
      const nextEpoch = get().projectOpenRequestEpoch + 1;
      set({ projectOpenRequestEpoch: nextEpoch });
      return nextEpoch;
    },
    claimProjectSaveRequest: () => {
      const nextEpoch = get().projectSaveRequestEpoch + 1;
      set({ projectSaveRequestEpoch: nextEpoch });
      return nextEpoch;
    },
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
  const { machine: openedMachine, ...projectWithoutMachine } = state.project;
  const keptKind = machineKindOf(notice.previousMachine);
  const { cnc, device } = openedCncWithCurrentHardware(state, notice);
  const kept: Project = {
    ...projectWithoutMachine,
    device,
    workspace: {
      ...state.project.workspace,
      width: notice.previousDevice.bedWidth,
      height: notice.previousDevice.bedHeight,
    },
    ...(keptKind === 'cnc' && cnc !== null
      ? { machine: cnc }
      : notice.previousMachine === undefined
        ? {}
        : { machine: notice.previousMachine }),
  };
  const switched = modeSwitchState(
    projectWithParkedCnc(kept, cnc),
    state.jobPlacement,
    machineKindOf(openedMachine),
    machineKindOf(kept.machine),
  );
  return {
    ...switched,
    cachedCncMachine: switched.project.parkedCncMachine ?? null,
    projectBedReconciliation: null,
    dirty: true,
  };
}

function openedCncWithCurrentHardware(
  state: AppState,
  notice: ProjectBedReconciliationNotice,
): { readonly device: Project['device']; readonly cnc: CncMachineConfig | null } {
  const openedCnc =
    state.project.machine?.kind === 'cnc' ? state.project.machine : state.project.parkedCncMachine;
  const needsCnc = openedCnc !== undefined || machineKindOf(notice.previousMachine) === 'cnc';
  if (notice.previousCncParams === undefined && !needsCnc) {
    return { device: notice.previousDevice, cnc: null };
  }
  const params = cncParamsWithOwnFeeds(
    notice.previousCncParams ?? DEFAULT_CNC_MACHINE_CONFIG.params,
    notice.previousDevice,
  );
  // Stock, cutter definitions/selection and tiling belong to the opened job.
  // Only physical parameters come from the machine chosen before Open.
  const cnc = needsCnc
    ? {
        ...(openedCnc ??
          cncMachineWithReusableTools(DEFAULT_CNC_MACHINE_CONFIG, state.cncLibrary.customTools)),
        params: { ...params },
      }
    : null;
  return { device: { ...notice.previousDevice, cncSubProfile: { ...params } }, cnc };
}

function retainedApplicationState(
  state: AppState,
): Pick<
  AppState,
  | 'layerDefaults'
  | 'cncLibrary'
  | 'cncLiveCaps'
  | 'projectOpenRequestEpoch'
  | 'projectSaveRequestEpoch'
  | 'projectSaveWriteCoordinator'
  | 'sceneClipboard'
> &
  ReturnType<typeof currentMaterialLibraryState> &
  ReturnType<typeof currentSavedLibrariesState> {
  return {
    ...currentMaterialLibraryState(state),
    ...currentSavedLibrariesState(state),
    layerDefaults: { ...state.layerDefaults, applyToNewOperations: false },
    cncLibrary: state.cncLibrary,
    cncLiveCaps: state.cncLiveCaps,
    projectOpenRequestEpoch: state.projectOpenRequestEpoch,
    projectSaveRequestEpoch: state.projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    sceneClipboard: state.sceneClipboard,
  };
}

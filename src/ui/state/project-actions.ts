import { layerDefaultsAutoApply } from './layer-defaults-preference';
import { studioDocumentActions, type StudioDocumentActions } from './studio-document-actions';
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
import { preserveUnadmittedProProject } from './pending-pro-project';
import {
  productionManifestActions,
  type ProductionManifestActions,
} from './production-manifest-actions';
import { retainedArrayActions, type RetainedArrayActions } from './retained-array-actions';
import type { AppState } from './store';
import { useUiStore } from './ui-store';
import { applyStartPointDefaults } from './start-point-defaults';
import {
  canonicalizeOpenedProjectBed,
  withCurrentMachineAutofocus,
  withCurrentMachineCamera,
  withCurrentMachineSetup,
  type ProjectBedReconciliationNotice,
} from './project-bed-reconciliation';
import { pushUndo } from './scene-mutations';
import { captureSetupHistoryContext } from './setup-history-context';
import { useToastStore } from './toast-store';
import { projectSheetActions, type ProjectSheetActions } from './project-sheet-actions';
import { JOB_MACHINE_OPEN_REFUSED, refuseJobMachineChange } from './job-machine-lock';

type ProjectActionSet = (
  fn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;
type ProjectActionGet = () => AppState;
type InitialStateFactory = (project?: Project) => Partial<AppState>;

/**
 * Commits an edit through the store's authoring guard (ADR-540 Amendment 1
 * item 6, ADR-592 decision 5): without Pro, new or changed Pro work waits for
 * the Pro prompt. Returns false while it waits; `onCommitted` runs only once
 * the edit lands, and a delayed commit checks `isCurrent` again first.
 */
export type ProjectEditCommit = (
  update: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
  onCommitted?: () => void,
  isCurrent?: () => boolean,
) => boolean;

export type ProjectActions = StudioDocumentActions &
  ProjectSheetActions &
  ProductionManifestActions &
  RetainedArrayActions & {
    /** Edits built outside the store commit here, never through `useStore.setState`. */
    readonly commitProjectEdit: ProjectEditCommit;
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
  authoringSet: ProjectEditCommit,
): ProjectActions {
  return {
    ...projectSheetActions(set, get),
    ...studioDocumentActions(set),
    ...productionManifestActions(set, get),
    // Regenerate adds copies of the arrayed artwork, so it asks for Pro as
    // creating an array does (ADR-540 Amendment 1 item 6).
    ...retainedArrayActions(authoringSet),
    commitProjectEdit: authoringSet,
    setProject: (project) => {
      const preserved = preserveUnadmittedProProject(project);
      if (preserved !== null) return { kind: 'desktop-required', features: preserved.features };
      const current = get();
      const resolution = resolveProjectMachineCapability(project, current.cncLibrary.customTools);
      const bedResolution = canonicalizeOpenedProjectBed(resolution.project, current.project);
      const autofocus = withCurrentMachineAutofocus(bedResolution.project, current.project);
      const camera = withCurrentMachineCamera(autofocus.project, current.project);
      const setup = withCurrentMachineSetup(camera.project, current.project);
      // A file on another machine waits for a running job (ADR-416 Amendment 2).
      if (refuseJobMachineChange(current.project, setup.project, JOB_MACHINE_OPEN_REFUSED))
        return { kind: 'job-machine-locked' };
      useUiStore.getState().resetArtworkRunOrder();
      set((state) => ({
        ...initialState(setup.project),
        ...retainedApplicationState(state),
        projectDocumentEpoch: state.projectDocumentEpoch + 1,
        // A laser file's parked CNC setup, with the kept machine values.
        cachedCncMachine: setup.project.parkedCncMachine ?? resolution.cachedCncMachine,
        projectBedReconciliation: bedResolution.notice,
        dirty: bedResolution.notice?.workspaceMismatch === true,
      }));
      if (autofocus.keptCurrentCommand) noteKeptAutofocusCommand();
      if (camera.keptCurrentCamera) noteKeptCameraCalibration();
      if (setup.replaced.length > 0) noteKeptMachineSetup(setup.replaced);
      const loneArtworkId = loneSelectableArtworkId(setup.project.scene);
      if (loneArtworkId !== null && get().selectedObjectId === null)
        get().selectObject(loneArtworkId);
      return bedResolution.notice?.workspaceMismatch === true
        ? { ...resolution.loadResult, projectBedReconciled: true }
        : resolution.loadResult;
    },
    newProject: () => {
      useUiStore.getState().resetArtworkRunOrder();
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
        const blankProject = applyStartPointDefaults(createProject(device));
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
      });
    },
    claimProjectOpenRequest: () => {
      const nextEpoch = get().projectOpenRequestEpoch + 1;
      set({ projectOpenRequestEpoch: nextEpoch });
      return nextEpoch;
    },
    claimProjectSaveRequest: () => claimProjectSaveRequest(set, get),
    acceptOpenedProjectMachine: () => set({ projectBedReconciliation: null }),
    keepCurrentMachineForOpenedProject: () =>
      set((state) => keepCurrentMachinePatch(state, state.projectBedReconciliation)),
  };
}

function claimProjectSaveRequest(set: ProjectActionSet, get: ProjectActionGet): number {
  // Save commits the visible numbering order as one undo step. Retire its
  // rollback before any picker/write awaits, so Cancel cannot later restore
  // different content while retaining this save's clean status and target.
  if (useUiStore.getState().artworkNumbering.kind === 'active') {
    get().endInteraction();
    useUiStore.getState().finishArtworkNumbering();
  }
  const nextEpoch = get().projectSaveRequestEpoch + 1;
  set({ projectSaveRequestEpoch: nextEpoch });
  return nextEpoch;
}

function noteKeptCameraCalibration(): void {
  useToastStore
    .getState()
    .pushToast(
      "This file's camera calibration was not used: the camera keeps your machine's current calibration.",
      'info',
    );
}

// The file's copy of the machine is never used for the machine in use
// (ADR-500 Amendment 2), and the operator hears which values it held.
function noteKeptMachineSetup(replaced: ReadonlyArray<string>): void {
  const what =
    replaced.length === 1
      ? replaced[0]
      : `${replaced.slice(0, -1).join(', ')} and ${replaced[replaced.length - 1]}`;
  useToastStore
    .getState()
    .pushToast(
      `This file's machine settings were not used (${what}): your machine keeps its current setup from Machine Setup.`,
      'info',
    );
}

function noteKeptAutofocusCommand(): void {
  useToastStore
    .getState()
    .pushToast(
      "This file's Auto-focus command was not used: Auto-focus keeps your machine's own command from Machine Setup.",
      'info',
    );
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
  // Its own Undo step, like every other machine change (ADR-440 Amendment 6):
  // snapshots taken before it hold the file's machine, so an Undo of an older
  // edit, or a Redo, must not put that machine back unseen. Undoing this step
  // brings the notice back with the file's machine; Redo takes it away again.
  captureSetupHistoryContext(state.project, state);
  return {
    ...switched,
    cachedCncMachine: switched.project.parkedCncMachine ?? null,
    projectBedReconciliation: null,
    undoStack: pushUndo(state.project, state.undoStack, 'Keep current machine'),
    redoStack: [],
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
    layerDefaults: { ...state.layerDefaults, applyToNewOperations: layerDefaultsAutoApply() },
    cncLibrary: state.cncLibrary,
    cncLiveCaps: state.cncLiveCaps,
    projectOpenRequestEpoch: state.projectOpenRequestEpoch,
    projectSaveRequestEpoch: state.projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    sceneClipboard: state.sceneClipboard,
  };
}

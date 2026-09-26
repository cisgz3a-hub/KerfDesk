import { cncMachineWithOwnFeeds } from '../../core/cnc/cnc-head-feeds';
import type { DeviceProfile } from '../../core/devices';
import { deviceSupportsMachineKind } from '../../core/devices/device-profile';
import {
  machineKindOf,
  type CncMachineConfig,
  type CncTool,
  type MachineConfig,
  type Project,
} from '../../core/scene';
import { jobPlacementAfterProfileSelection } from '../job-placement';
import { sceneAfterMachineSetup } from './cnc-machine-setup-scene';
import { projectWithStockMaterial } from './cnc-project-material';
import {
  sceneWithCncStartupOperationDrafts,
  type CncStartupOperationDraft,
} from './cnc-startup-setup';
import { cncMachineWithCustomTools } from './machine-actions';
import { modeSwitchState } from './mode-switch-settings';
import { projectWithParkedCnc } from './parked-cnc-machine';
import { nextProbeSetupState } from './probe-setup-history-identity';
import { pushUndo } from './scene-mutations';
import { captureSetupHistoryContext } from './setup-history-context';
import type { AppState } from './store';

type Setter = (
  fn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;

export type MachineSetupReplacementResult =
  | { readonly kind: 'applied' }
  | {
      readonly kind: 'applied-with-capability-warning';
      readonly requestedKind: MachineConfig['kind'];
    };

export type CncStartupSetupReplacement = {
  readonly operationDrafts: ReadonlyArray<CncStartupOperationDraft>;
  readonly materialApplyRequested: boolean;
  readonly customTools: ReadonlyArray<CncTool>;
};

export type MachineSetupActions = {
  readonly replaceMachineSetup: (
    ...args: [DeviceProfile, MachineConfig, MachineConfig?]
  ) => MachineSetupReplacementResult;
  readonly replaceCncStartupSetup: (
    profile: DeviceProfile,
    machine: MachineConfig,
    retainedMachine: MachineConfig | undefined,
    startup: CncStartupSetupReplacement,
  ) => MachineSetupReplacementResult;
};

export function machineSetupActions(set: Setter): MachineSetupActions {
  return {
    replaceMachineSetup: (profile, machine, retainedMachine) => {
      set((state) => replacementState(state, profile, machine, retainedMachine));
      return deviceSupportsMachineKind(profile, machine.kind)
        ? { kind: 'applied' }
        : { kind: 'applied-with-capability-warning', requestedKind: machine.kind };
    },
    replaceCncStartupSetup: (profile, machine, retainedMachine, startup) => {
      set((state) => replacementState(state, profile, machine, retainedMachine, startup));
      return deviceSupportsMachineKind(profile, machine.kind)
        ? { kind: 'applied' }
        : { kind: 'applied-with-capability-warning', requestedKind: machine.kind };
    },
  };
}

function replacementState(
  state: AppState,
  profile: DeviceProfile,
  machine: MachineConfig,
  retainedMachine?: MachineConfig,
  startup?: CncStartupSetupReplacement,
): Partial<AppState> {
  captureSetupHistoryContext(state.project, state);
  const customTools = startup?.customTools ?? state.cncLibrary.customTools;
  const nextMachine = machineWithTools(machine, customTools, profile);
  const retainedCnc = retainedCncForSetup(state, nextMachine, retainedMachine);
  const nextCachedCnc = cachedCncWithTools(retainedCnc, customTools, profile);
  const nextProfile = profileWithCncSettings(profile, nextCachedCnc);
  const scene = sceneAfterMachineSetup(
    state.project.scene,
    state.project.machine,
    nextProfile,
    nextMachine,
    state.cncLiveCaps,
  );
  // A setup that changes the mode swaps in that mode's placement and Output
  // switches, as the Laser/CNC toggle does (ADR-416).
  const switched = modeSwitchState(
    projectWithParkedCnc(
      projectWithStartupChanges(
        projectWithMachine(state.project, nextProfile, nextMachine, scene),
        state.cncLiveCaps,
        startup,
      ),
      nextCachedCnc,
    ),
    state.jobPlacement,
    machineKindOf(state.project.machine),
    nextMachine.kind,
  );
  return {
    ...nextProbeSetupState(switched.project, state.probeSetupEpoch),
    jobPlacement: jobPlacementAfterProfileSelection(
      switched.jobPlacement,
      state.project.device,
      nextProfile,
    ),
    cachedCncMachine: nextCachedCnc,
    ...(startup === undefined
      ? {}
      : { cncLibrary: { ...state.cncLibrary, customTools: startup.customTools } }),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function projectWithMachine(
  project: Project,
  device: DeviceProfile,
  machine: MachineConfig,
  scene: Project['scene'],
): Project {
  return {
    ...project,
    scene,
    device,
    machine,
    workspace: { ...project.workspace, width: device.bedWidth, height: device.bedHeight },
  };
}

function projectWithStartupChanges(
  project: Project,
  liveCaps: AppState['cncLiveCaps'],
  startup: CncStartupSetupReplacement | undefined,
): Project {
  const machine = project.machine;
  if (startup === undefined || machine?.kind !== 'cnc') return project;
  const materialProject = startup.materialApplyRequested
    ? projectWithStockMaterial(project, machine.stock.materialKey ?? null, liveCaps)
    : project;
  const materialMachine = materialProject.machine;
  if (materialMachine?.kind !== 'cnc') return materialProject;
  const scene = sceneWithCncStartupOperationDrafts({
    scene: materialProject.scene,
    machine: materialMachine,
    profile: materialProject.device,
    liveCaps,
    drafts: startup.operationDrafts,
  });
  return scene === materialProject.scene ? materialProject : { ...materialProject, scene };
}

function machineWithTools(
  machine: MachineConfig,
  customTools: ReadonlyArray<CncTool>,
  profile: DeviceProfile,
): MachineConfig {
  if (machine.kind !== 'cnc') return machine;
  return cncMachineWithOwnFeeds(cncMachineWithCustomTools(machine, customTools), profile);
}

function retainedCncForSetup(
  state: AppState,
  nextMachine: MachineConfig,
  retainedMachine?: MachineConfig,
): CncMachineConfig | null {
  if (nextMachine.kind === 'cnc') return nextMachine;
  if (retainedMachine?.kind === 'cnc') return retainedMachine;
  if (state.project.machine?.kind === 'cnc') return state.project.machine;
  return state.cachedCncMachine;
}

function cachedCncWithTools(
  machine: CncMachineConfig | null,
  customTools: ReadonlyArray<CncTool>,
  profile: DeviceProfile,
): CncMachineConfig | null {
  if (machine === null) return null;
  return cncMachineWithOwnFeeds(cncMachineWithCustomTools(machine, customTools), profile);
}

function profileWithCncSettings(
  profile: DeviceProfile,
  cachedCnc: CncMachineConfig | null,
): DeviceProfile {
  if (profile.capabilities?.includes('cnc-output') !== true || cachedCnc === null) return profile;
  return { ...profile, cncSubProfile: { ...cachedCnc.params } };
}

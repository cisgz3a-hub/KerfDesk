import type { DeviceProfile } from '../../core/devices';
import { deviceSupportsMachineKind } from '../../core/devices/device-profile';
import type { CncMachineConfig, CncTool, MachineConfig, Project } from '../../core/scene';
import { jobPlacementAfterProfileSelection } from '../job-placement';
import { sceneAfterMachineSetup } from './cnc-machine-setup-scene';
import { projectWithStockMaterial } from './cnc-project-material';
import {
  sceneWithCncStartupOperationDrafts,
  type CncStartupOperationDraft,
} from './cnc-startup-setup';
import { cncMachineWithCustomTools } from './machine-actions';
import { nextProbeSetupState } from './probe-setup-history-identity';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

type Setter = (
  fn: AppState | Partial<AppState> | ((state: AppState) => AppState | Partial<AppState>),
) => void;

export type MachineSetupReplacementResult =
  | { readonly kind: 'applied' }
  | { readonly kind: 'blocked-by-capability'; readonly requestedKind: MachineConfig['kind'] };

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
      if (!deviceSupportsMachineKind(profile, machine.kind)) {
        return { kind: 'blocked-by-capability', requestedKind: machine.kind };
      }
      set((state) => replacementState(state, profile, machine, retainedMachine));
      return { kind: 'applied' };
    },
    replaceCncStartupSetup: (profile, machine, retainedMachine, startup) => {
      if (!deviceSupportsMachineKind(profile, machine.kind)) {
        return { kind: 'blocked-by-capability', requestedKind: machine.kind };
      }
      set((state) => replacementState(state, profile, machine, retainedMachine, startup));
      return { kind: 'applied' };
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
  const customTools = startup?.customTools ?? state.cncLibrary.customTools;
  const nextMachine = machineWithTools(machine, customTools);
  const retainedCnc = retainedCncForSetup(state, nextMachine, retainedMachine);
  const nextCachedCnc = cachedCncWithTools(retainedCnc, customTools);
  const nextProfile = profileWithCncSettings(profile, nextCachedCnc);
  const scene = sceneAfterMachineSetup(
    state.project.scene,
    state.project.machine,
    nextProfile,
    nextMachine,
    state.cncLiveCaps,
  );
  const setupProject = projectWithStartupChanges(
    projectWithMachine(state.project, nextProfile, nextMachine, scene),
    state.cncLiveCaps,
    startup,
  );
  return {
    ...nextProbeSetupState(setupProject, state.probeSetupEpoch),
    jobPlacement: jobPlacementAfterProfileSelection(
      state.jobPlacement,
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
): MachineConfig {
  return machine.kind === 'cnc' ? cncMachineWithCustomTools(machine, customTools) : machine;
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
): CncMachineConfig | null {
  return machine === null ? null : cncMachineWithCustomTools(machine, customTools);
}

function profileWithCncSettings(
  profile: DeviceProfile,
  cachedCnc: CncMachineConfig | null,
): DeviceProfile {
  if (profile.capabilities?.includes('cnc-output') !== true || cachedCnc === null) return profile;
  return { ...profile, cncSubProfile: { ...cachedCnc.params } };
}

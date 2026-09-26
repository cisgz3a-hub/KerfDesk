// Pure state machine for the unified Machine Setup flow. The wizard edits a
// DeviceProfile and MachineConfig together, but neither reaches the live
// project until the final atomic Save action.

import type { Dispatch } from 'react';
import { selectControllerDriver } from '../../../core/controllers';
import { controllerProfileForSelection } from './device-setup-controller-selection';
import { explicitMachineKindsForProfile } from '../../../core/devices/device-profile';
import { deviceProfileWithInteractivePatch } from '../../../core/devices/device-profile-patch';
import {
  validateMachineProfile,
  type ControllerKind,
  type DeviceProfile,
  type ProfileCapability,
} from '../../../core/devices';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  LASER_MACHINE_CONFIG,
  assertNever,
  machineKindOf,
  type CncMachineConfig,
  type MachineConfig,
  type MachineKind,
} from '../../../core/scene';
import { acceptDetectedPatch } from './device-setup-accept-detected';
import { deviceSetupSupportsMachineKind } from './device-setup-capability';
import { mergeDetectedSetupFacts } from './device-setup-detected-facts';
import {
  deviceSetupStage,
  deviceSetupStepOrder,
  isDeviceSetupStep,
  type DeviceSetupStep,
} from './device-setup-steps';

export { deviceSetupSupportsMachineKind } from './device-setup-capability';
export {
  CNC_DEVICE_SETUP_STEP_ORDER,
  DEVICE_SETUP_STEP_ORDER,
  deviceSetupStepOrder,
  type DeviceSetupStep,
} from './device-setup-steps';

// Three visible stages share one draft. Legacy section targets still open
// their matching editor, and only the final Save changes the project.
export type DeviceSetupState = {
  readonly step: DeviceSetupStep;
  // Physical output capability. This may contain both kinds, while
  // `machineKind` remains the one active project/compiler mode after Save.
  readonly machineKinds: ReadonlyArray<MachineKind>;
  readonly machineKind: MachineKind;
  readonly baseline: DeviceProfile;
  readonly baselineMachine: MachineConfig;
  // Controller observations stay separate until the operator explicitly
  // chooses Use detected values. Identity never rewrites a chosen profile.
  readonly detected: Partial<DeviceProfile>;
  readonly detectedControllerKind: ControllerKind | null;
  readonly controllerRead: boolean;
  readonly detectedApplied: boolean;
  readonly draft: DeviceProfile;
  readonly draftMachine: MachineConfig;
  // Retain CNC values when the operator briefly switches Laser -> CNC -> Laser.
  readonly cncDraft: CncMachineConfig;
  readonly presetApplied: boolean;
  readonly firmwareBackupConfirmed: boolean;
  readonly queuedFirmwareWriteIds: ReadonlyArray<number>;
};

export type DeviceSetupAction =
  | { readonly kind: 'next' }
  | { readonly kind: 'back' }
  | { readonly kind: 'go'; readonly step: DeviceSetupStep }
  // Undo of an automatic fill (ADR-420): the draft returns, the observations stay.
  | { readonly kind: 'restore'; readonly state: DeviceSetupState }
  | { readonly kind: 'edit'; readonly patch: Partial<DeviceProfile> }
  | { readonly kind: 'edit-machine'; readonly machine: MachineConfig }
  | {
      readonly kind: 'set-machine-kinds';
      readonly machineKinds: readonly [MachineKind, ...MachineKind[]];
    }
  | { readonly kind: 'select-machine-kind'; readonly machineKind: MachineKind }
  | { readonly kind: 'select-controller'; readonly controllerKind: ControllerKind }
  | { readonly kind: 'apply-preset'; readonly profile: DeviceProfile }
  | {
      readonly kind: 'accept-detected';
      readonly patch: Partial<DeviceProfile>;
      readonly useSpindleScaleAsRpm?: boolean;
    }
  | { readonly kind: 'set-firmware-backup-confirmed'; readonly confirmed: boolean }
  | { readonly kind: 'toggle-firmware-write'; readonly id: number }
  | {
      readonly kind: 'detected-updated';
      readonly detected?: Partial<DeviceProfile>;
      readonly detectedControllerKind?: ControllerKind | null;
      readonly controllerRead?: boolean;
    };

export type DeviceSetupDetectedFacts = {
  readonly detectedControllerKind?: ControllerKind | null;
  readonly controllerRead?: boolean;
  // `machineKind` remains accepted for pure callers and older tests. The live
  // wizard passes the complete MachineConfig so CNC values are never split
  // from the device draft.
  readonly machineKind?: MachineKind;
  readonly machine?: MachineConfig;
  readonly fallbackCncMachine?: CncMachineConfig;
};

export type DeviceSetupStepProps = {
  readonly state: DeviceSetupState;
  readonly dispatch: Dispatch<DeviceSetupAction>;
};

export function initDeviceSetup(
  profile: DeviceProfile,
  detected: Partial<DeviceProfile> | null,
  facts: DeviceSetupDetectedFacts = {},
): DeviceSetupState {
  const controllerRead =
    facts.controllerRead ?? (detected !== null || facts.detectedControllerKind !== undefined);
  const baselineMachine = initialMachine(facts);
  const cncDraft = initialCncDraft(profile, baselineMachine, facts.fallbackCncMachine);
  const baselineKind = machineKindOf(baselineMachine);
  const machineKinds = initialMachineKinds(profile, baselineKind);
  const machineKind = initialActiveMachineKind(machineKinds, baselineKind);
  return {
    step: 'identify',
    machineKinds,
    machineKind,
    baseline: profile,
    baselineMachine,
    detected: detected ?? {},
    detectedControllerKind: facts.detectedControllerKind ?? null,
    controllerRead,
    detectedApplied: false,
    draft: profile,
    draftMachine: machineKind === 'cnc' ? cncDraft : LASER_MACHINE_CONFIG,
    cncDraft,
    presetApplied: false,
    firmwareBackupConfirmed: false,
    queuedFirmwareWriteIds: [],
  };
}

function initialMachine(facts: DeviceSetupDetectedFacts): MachineConfig {
  if (facts.machine !== undefined) return facts.machine;
  if (facts.machineKind === 'cnc') return facts.fallbackCncMachine ?? DEFAULT_CNC_MACHINE_CONFIG;
  return LASER_MACHINE_CONFIG;
}

function initialCncDraft(
  profile: DeviceProfile,
  baselineMachine: MachineConfig,
  fallbackCncMachine?: CncMachineConfig,
): CncMachineConfig {
  const draft =
    baselineMachine.kind === 'cnc'
      ? baselineMachine
      : (fallbackCncMachine ?? DEFAULT_CNC_MACHINE_CONFIG);
  if (baselineMachine.kind === 'cnc' || profile.cncSubProfile === undefined) return draft;
  return { ...draft, params: { ...profile.cncSubProfile } };
}

function initialMachineKinds(
  profile: DeviceProfile,
  baselineKind: MachineKind,
): ReadonlyArray<MachineKind> {
  const explicitKinds = explicitMachineKindsForProfile(profile);
  return explicitKinds.length === 0 ? [baselineKind] : explicitKinds;
}

function initialActiveMachineKind(
  machineKinds: ReadonlyArray<MachineKind>,
  baselineKind: MachineKind,
): MachineKind {
  return machineKinds.includes(baselineKind) ? baselineKind : (machineKinds[0] ?? 'laser');
}

export function deviceSetupReducer(
  state: DeviceSetupState,
  action: DeviceSetupAction,
): DeviceSetupState {
  if (action.kind === 'next') return { ...state, step: adjacentStep(state, 1) };
  if (action.kind === 'back') return { ...state, step: adjacentStep(state, -1) };
  if (action.kind === 'go') {
    return isDeviceSetupStep(action.step) ? { ...state, step: action.step } : state;
  }
  if (action.kind === 'restore') {
    const { step, detected, detectedControllerKind, controllerRead } = state;
    const facts = { step, detected, detectedControllerKind, controllerRead };
    return invalidateFirmwarePlan(action.state, { ...facts, detectedApplied: false });
  }
  return reduceDraftAction(state, action);
}

function reduceDraftAction(
  state: DeviceSetupState,
  action: Exclude<DeviceSetupAction, { readonly kind: 'next' | 'back' | 'go' | 'restore' }>,
): DeviceSetupState {
  switch (action.kind) {
    case 'edit':
      return invalidateFirmwarePlan(state, {
        draft: deviceProfileWithInteractivePatch(state.draft, action.patch),
      });
    case 'edit-machine':
      return editMachineDraft(state, action.machine);
    case 'set-machine-kinds':
      return setMachineKinds(state, action.machineKinds);
    case 'select-machine-kind':
      return selectMachineKind(state, action.machineKind);
    case 'select-controller':
      return selectController(state, action.controllerKind);
    case 'accept-detected':
      return invalidateFirmwarePlan(
        state,
        acceptDetectedPatch(state, action.patch, action.useSpindleScaleAsRpm === true),
      );
    case 'apply-preset':
      return applyPreset(state, action.profile);
    case 'set-firmware-backup-confirmed':
      return {
        ...state,
        firmwareBackupConfirmed: action.confirmed,
        queuedFirmwareWriteIds: action.confirmed ? state.queuedFirmwareWriteIds : [],
      };
    case 'toggle-firmware-write':
      return toggleFirmwareWrite(state, action.id);
    case 'detected-updated':
      return updateDetectedFacts(state, action);
    default:
      return assertNever(action);
  }
}

function editMachineDraft(state: DeviceSetupState, machine: MachineConfig): DeviceSetupState {
  if (machine.kind === 'laser') {
    return invalidateFirmwarePlan(state, {
      ...(state.machineKind === 'laser' ? { draftMachine: machine } : {}),
    });
  }
  return invalidateFirmwarePlan(state, {
    cncDraft: machine,
    ...(state.machineKind === 'cnc' ? { draftMachine: machine } : {}),
  });
}

function setMachineKinds(
  state: DeviceSetupState,
  requested: readonly [MachineKind, ...MachineKind[]],
): DeviceSetupState {
  const machineKinds = (['laser', 'cnc'] as const).filter((kind) => requested.includes(kind));
  const machineKind = machineKinds.includes(state.machineKind) ? state.machineKind : requested[0];
  return invalidateFirmwarePlan(state, {
    machineKinds,
    machineKind,
    draftMachine: machineKind === 'cnc' ? state.cncDraft : LASER_MACHINE_CONFIG,
  });
}

function selectMachineKind(state: DeviceSetupState, machineKind: MachineKind): DeviceSetupState {
  if (machineKind === state.machineKind) return state;
  return invalidateFirmwarePlan(state, {
    machineKind,
    draftMachine: machineKind === 'cnc' ? state.cncDraft : LASER_MACHINE_CONFIG,
  });
}

function selectController(
  state: DeviceSetupState,
  controllerKind: ControllerKind,
): DeviceSetupState {
  return invalidateFirmwarePlan(state, {
    draft: controllerProfileForSelection(state.draft, controllerKind),
  });
}

function toggleFirmwareWrite(state: DeviceSetupState, id: number): DeviceSetupState {
  if (!state.firmwareBackupConfirmed) return state;
  const queued = state.queuedFirmwareWriteIds.includes(id);
  return {
    ...state,
    queuedFirmwareWriteIds: queued
      ? state.queuedFirmwareWriteIds.filter((candidate) => candidate !== id)
      : [...state.queuedFirmwareWriteIds, id],
  };
}

function applyPreset(state: DeviceSetupState, profile: DeviceProfile): DeviceSetupState {
  const explicitKinds = explicitMachineKindsForProfile(profile);
  const machineKinds = explicitKinds.length === 0 ? state.machineKinds : explicitKinds;
  const machineKind = machineKinds.includes(state.machineKind)
    ? state.machineKind
    : (machineKinds[0] ?? 'laser');
  const cncDraft =
    profile.cncSubProfile === undefined
      ? state.cncDraft
      : { ...state.cncDraft, params: { ...profile.cncSubProfile } };
  return invalidateFirmwarePlan(state, {
    draft: profile,
    machineKinds,
    machineKind,
    draftMachine: machineKind === 'cnc' ? cncDraft : LASER_MACHINE_CONFIG,
    cncDraft,
    presetApplied: true,
    // Picking a catalog card replaces the draft with that profile verbatim, so
    // any earlier "Use detected values" no longer describes what is on screen.
    // Leaving this true kept the Connect step claiming detected values were
    // applied to a draft they had just been overwritten in.
    detectedApplied: false,
  });
}

export function machineSetupProfile(state: DeviceSetupState): DeviceProfile {
  const { capabilities: draftCapabilities, cncSubProfile: _discardedCnc, ...base } = state.draft;
  void _discardedCnc;
  const capabilities: ProfileCapability[] = (draftCapabilities ?? []).filter(
    (capability) => capability !== 'laser-output' && capability !== 'cnc-output',
  );
  if (deviceSetupSupportsMachineKind(state, 'laser')) capabilities.push('laser-output');
  if (deviceSetupSupportsMachineKind(state, 'cnc')) capabilities.push('cnc-output');
  return {
    ...base,
    capabilities,
    ...(deviceSetupSupportsMachineKind(state, 'cnc')
      ? { cncSubProfile: { ...state.cncDraft.params } }
      : {}),
  };
}

function updateDetectedFacts(
  state: DeviceSetupState,
  action: Extract<DeviceSetupAction, { readonly kind: 'detected-updated' }>,
): DeviceSetupState {
  const facts = mergeDetectedSetupFacts(state, action);
  return facts === null ? state : invalidateFirmwarePlan(state, facts);
}

function invalidateFirmwarePlan(
  state: DeviceSetupState,
  patch: Partial<DeviceSetupState>,
): DeviceSetupState {
  return {
    ...state,
    ...patch,
    firmwareBackupConfirmed: false,
    queuedFirmwareWriteIds: [],
  };
}

export function machineSetupValidationIssues(state: DeviceSetupState): ReadonlyArray<string> {
  const issues = [...validateMachineProfile(machineSetupProfile(state))];
  const driver = selectControllerDriver(
    state.draft.controllerKind,
    state.draft.controllerCommandSet,
  );
  if (state.machineKind === 'cnc' && !driver.capabilities.cncJobs) {
    issues.push(`${driver.label} cannot run KerfDesk CNC jobs. Choose a GRBL-family controller.`);
  }
  if (state.machineKind === 'cnc') {
    const params = state.cncDraft.params;
    if (!positive(params.safeZMm)) issues.push('CNC safe Z must be greater than zero.');
    if (!positive(params.spindleMaxRpm)) {
      issues.push('CNC spindle maximum must be greater than zero.');
    }
    if (!Number.isFinite(params.spindleSpinupSec) || params.spindleSpinupSec < 0) {
      issues.push('CNC spindle spin-up delay must be at or above zero.');
    }
  }
  return issues;
}

export function canAdvanceDeviceSetup(state: DeviceSetupState): boolean {
  // Review explains all invalid values. Navigation must never strand a user
  // away from an editor; validation belongs to the final Save action.
  return deviceSetupStage(state.step) !== 'review';
}

export function isFirstDeviceSetupStep(step: DeviceSetupStep, machineKind: MachineKind): boolean {
  return deviceSetupStage(step) === deviceSetupStepOrder(machineKind)[0];
}

export function isLastDeviceSetupStep(step: DeviceSetupStep, machineKind: MachineKind): boolean {
  const order = deviceSetupStepOrder(machineKind);
  return step === order[order.length - 1];
}

function adjacentStep(state: DeviceSetupState, delta: number): DeviceSetupStep {
  const order = deviceSetupStepOrder(state.machineKind);
  const index = order.indexOf(deviceSetupStage(state.step));
  if (index < 0) return order[0] ?? state.step;
  const clamped = Math.min(order.length - 1, Math.max(0, index + delta));
  return order[clamped] ?? state.step;
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

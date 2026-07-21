// Pure state machine for the unified Machine Setup flow. The wizard edits a
// DeviceProfile and MachineConfig together, but neither reaches the live
// project until the final atomic Save action.

import type { Dispatch } from 'react';
import { selectControllerDriver } from '../../../core/controllers';
import { explicitMachineKindsForProfile } from '../../../core/devices/device-profile';
import { deviceProfileWithInteractivePatch } from '../../../core/devices/device-profile-patch';
import {
  controllerCompatibleProfile,
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
import { deviceSetupSupportsMachineKind } from './device-setup-capability';
import { mergeDetectedSetupFacts } from './device-setup-detected-facts';

export { deviceSetupSupportsMachineKind } from './device-setup-capability';

// Six steps (ADR-240, maintainer-ordered): machine type first, then the
// profile catalog, then a dedicated connect-and-detect page, then one flat
// confirm page (coordinates + machine output), optional calibrations as
// closed status rows, and firmware comparison + review before the single
// atomic Save.
export type DeviceSetupStep =
  | 'capability'
  | 'identify'
  | 'connect'
  | 'confirm'
  | 'options'
  | 'review';

export const DEVICE_SETUP_STEP_ORDER: ReadonlyArray<DeviceSetupStep> = [
  'capability',
  'identify',
  'connect',
  'confirm',
  'options',
  'review',
];

export function deviceSetupStepOrder(_machineKind: MachineKind): ReadonlyArray<DeviceSetupStep> {
  return DEVICE_SETUP_STEP_ORDER;
}

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
  | { readonly kind: 'edit'; readonly patch: Partial<DeviceProfile> }
  | { readonly kind: 'edit-machine'; readonly machine: MachineConfig }
  | {
      readonly kind: 'set-machine-kinds';
      readonly machineKinds: readonly [MachineKind, ...MachineKind[]];
    }
  | { readonly kind: 'select-machine-kind'; readonly machineKind: MachineKind }
  | { readonly kind: 'select-controller'; readonly controllerKind: ControllerKind }
  | { readonly kind: 'apply-preset'; readonly profile: DeviceProfile }
  | { readonly kind: 'accept-detected'; readonly patch: Partial<DeviceProfile> }
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
    step: 'capability',
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
    return DEVICE_SETUP_STEP_ORDER.includes(action.step) ? { ...state, step: action.step } : state;
  }
  return reduceDraftAction(state, action);
}

function reduceDraftAction(
  state: DeviceSetupState,
  action: Exclude<DeviceSetupAction, { readonly kind: 'next' | 'back' | 'go' }>,
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
      return acceptDetected(state, action.patch);
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
  const compatible = controllerCompatibleProfile(state.draft, controllerKind).profile;
  const driver = selectControllerDriver(controllerKind);
  return invalidateFirmwarePlan(state, {
    draft: {
      ...compatible,
      controllerKind,
      baudRate: driver.defaultBaudRate,
      minPowerS: 0,
      maxPowerS: defaultPowerScale(controllerKind),
    },
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

function acceptDetected(state: DeviceSetupState, patch: Partial<DeviceProfile>): DeviceSetupState {
  const profilePatch = profilePatchForMachineKind(patch, state.machineKind);
  const draft = controllerCompatibleProfile(
    deviceProfileWithInteractivePatch(state.draft, profilePatch),
    state.draft.controllerKind,
  ).profile;
  if (state.machineKind !== 'cnc' || !positive(patch.maxPowerS ?? 0)) {
    return invalidateFirmwarePlan(state, { detected: patch, draft, detectedApplied: true });
  }
  const cncDraft: CncMachineConfig = {
    ...state.cncDraft,
    params: { ...state.cncDraft.params, spindleMaxRpm: patch.maxPowerS ?? 0 },
  };
  const accepted = {
    detected: patch,
    draft,
    draftMachine: cncDraft,
    cncDraft,
    detectedApplied: true,
  };
  return invalidateFirmwarePlan(state, accepted);
}

function profilePatchForMachineKind(
  patch: Partial<DeviceProfile>,
  machineKind: MachineKind,
): Partial<DeviceProfile> {
  if (machineKind !== 'cnc') return patch;
  const shared = { ...patch };
  delete shared.maxPowerS;
  delete shared.minPowerS;
  delete shared.laserModeEnabled;
  return shared;
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
  const driver = selectControllerDriver(state.draft.controllerKind);
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
  switch (state.step) {
    // Capability and connect always advance: their pages hold no field that
    // could resolve a validation issue, so blocking Next there would strand
    // the operator away from the fix.
    case 'capability':
    case 'connect':
      return true;
    case 'identify':
    case 'confirm':
    case 'options':
      return machineSetupValidationIssues(state).length === 0;
    case 'review':
      return false;
    default:
      return assertNever(state.step);
  }
}

export function isFirstDeviceSetupStep(step: DeviceSetupStep, _machineKind: MachineKind): boolean {
  return step === DEVICE_SETUP_STEP_ORDER[0];
}

export function isLastDeviceSetupStep(step: DeviceSetupStep, _machineKind: MachineKind): boolean {
  return step === DEVICE_SETUP_STEP_ORDER[DEVICE_SETUP_STEP_ORDER.length - 1];
}

function adjacentStep(state: DeviceSetupState, delta: number): DeviceSetupStep {
  const index = DEVICE_SETUP_STEP_ORDER.indexOf(state.step);
  if (index < 0) return DEVICE_SETUP_STEP_ORDER[0] ?? state.step;
  const clamped = Math.min(DEVICE_SETUP_STEP_ORDER.length - 1, Math.max(0, index + delta));
  return DEVICE_SETUP_STEP_ORDER[clamped] ?? state.step;
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function defaultPowerScale(controllerKind: ControllerKind): number {
  if (controllerKind === 'marlin') return 255;
  if (controllerKind === 'smoothieware') return 1;
  return 1000;
}

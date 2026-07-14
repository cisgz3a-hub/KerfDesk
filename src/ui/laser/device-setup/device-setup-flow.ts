// Pure state machine for the unified Machine Setup flow. The wizard edits a
// DeviceProfile and MachineConfig together, but neither reaches the live
// project until the final atomic Save action.

import type { Dispatch } from 'react';
import { selectControllerDriver } from '../../../core/controllers';
import {
  controllerCompatibleProfile,
  validateMachineProfile,
  type ControllerKind,
  type DeviceProfile,
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

export type DeviceSetupStep =
  | 'identify'
  | 'connect'
  | 'confirm'
  | 'machine'
  | 'safety'
  | 'firmware'
  | 'review';

export const DEVICE_SETUP_STEP_ORDER: ReadonlyArray<DeviceSetupStep> = [
  'identify',
  'connect',
  'confirm',
  'machine',
  'safety',
  'firmware',
  'review',
];

export function deviceSetupStepOrder(_machineKind: MachineKind): ReadonlyArray<DeviceSetupStep> {
  return DEVICE_SETUP_STEP_ORDER;
}

export type DeviceSetupState = {
  readonly step: DeviceSetupStep;
  readonly machineKind: MachineKind;
  readonly baseline: DeviceProfile;
  readonly baselineMachine: MachineConfig;
  // Controller observations stay separate until the operator explicitly
  // chooses Use detected values. Identity never rewrites a chosen profile.
  readonly detected: Partial<DeviceProfile>;
  readonly detectedControllerKind: ControllerKind | null;
  readonly controllerRead: boolean;
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
  const cncDraft =
    baselineMachine.kind === 'cnc'
      ? baselineMachine
      : (facts.fallbackCncMachine ?? DEFAULT_CNC_MACHINE_CONFIG);
  return {
    step: 'identify',
    machineKind: machineKindOf(baselineMachine),
    baseline: profile,
    baselineMachine,
    detected: detected ?? {},
    detectedControllerKind: facts.detectedControllerKind ?? null,
    controllerRead,
    draft: profile,
    draftMachine: baselineMachine,
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
      return invalidateFirmwarePlan(state, { draft: { ...state.draft, ...action.patch } });
    case 'edit-machine':
      return invalidateFirmwarePlan(state, {
        machineKind: machineKindOf(action.machine),
        draftMachine: action.machine,
        ...(action.machine.kind === 'cnc' ? { cncDraft: action.machine } : {}),
      });
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
    { ...state.draft, ...profilePatch },
    state.draft.controllerKind,
  ).profile;
  if (state.draftMachine.kind !== 'cnc' || !positive(patch.maxPowerS ?? 0)) {
    return invalidateFirmwarePlan(state, { draft });
  }
  const draftMachine: CncMachineConfig = {
    ...state.draftMachine,
    params: { ...state.draftMachine.params, spindleMaxRpm: patch.maxPowerS ?? 0 },
  };
  return invalidateFirmwarePlan(state, { draft, draftMachine, cncDraft: draftMachine });
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
  return invalidateFirmwarePlan(state, { draft: profile, presetApplied: true });
}

function updateDetectedFacts(
  state: DeviceSetupState,
  action: Extract<DeviceSetupAction, { readonly kind: 'detected-updated' }>,
): DeviceSetupState {
  if (
    (action.detected === undefined || action.detected === state.detected) &&
    action.detectedControllerKind === undefined &&
    action.controllerRead === undefined
  ) {
    return state;
  }
  return invalidateFirmwarePlan(state, {
    detected: action.detected ?? state.detected,
    detectedControllerKind:
      action.detectedControllerKind === undefined
        ? state.detectedControllerKind
        : action.detectedControllerKind,
    controllerRead: action.controllerRead ?? true,
  });
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
  const issues = [...validateMachineProfile(state.draft)];
  const driver = selectControllerDriver(state.draft.controllerKind);
  if (state.draftMachine.kind === 'cnc' && !driver.capabilities.cncJobs) {
    issues.push(`${driver.label} cannot run KerfDesk CNC jobs. Choose a GRBL-family controller.`);
  }
  if (state.draftMachine.kind === 'cnc') {
    const params = state.draftMachine.params;
    if (!positive(params.safeZMm)) issues.push('CNC safe Z must be greater than zero.');
    if (!positive(params.spindleMaxRpm)) {
      issues.push('CNC spindle maximum must be greater than zero.');
    }
    if (!positive(params.spindleSpinupSec)) {
      issues.push('CNC spindle spin-up delay must be greater than zero.');
    }
  }
  return issues;
}

export function canAdvanceDeviceSetup(state: DeviceSetupState): boolean {
  switch (state.step) {
    case 'identify':
    case 'confirm':
    case 'machine':
    case 'safety':
      return machineSetupValidationIssues(state).length === 0;
    case 'connect':
    case 'firmware':
      return true;
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

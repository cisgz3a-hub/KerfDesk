// device-setup-flow.ts — the pure state machine behind the connect-time
// Device Setup wizard (ADR-092). Owns the step order, Back/Next/jump
// navigation, and the working draft profile. No React, no store, no I/O: the
// wizard component drives it with useReducer so every transition is
// unit-testable in isolation.

import type { Dispatch } from 'react';
import { validateMachineProfile, type DeviceProfile } from '../../../core/devices';
import { assertNever, type MachineKind } from '../../../core/scene';

// The flow is Connect -> Identify -> Confirm -> Safety -> Probe -> Sync
// (firmware) -> Review. Each step is a tagged value; the switches below use
// assertNever so a new step fails to compile until it is handled everywhere.
// 'probe' is a CNC touch-plate work-zero step (F-CNC20); it self-gates to a
// skip note in laser mode and is always optional.
export type DeviceSetupStep =
  | 'connect'
  | 'identify'
  | 'confirm'
  | 'safety'
  | 'probe'
  | 'firmware'
  | 'review';

export const DEVICE_SETUP_STEP_ORDER: ReadonlyArray<DeviceSetupStep> = [
  'connect',
  'identify',
  'confirm',
  'safety',
  'probe',
  'firmware',
  'review',
];

const LASER_DEVICE_SETUP_STEP_ORDER: ReadonlyArray<DeviceSetupStep> = [
  'connect',
  'identify',
  'confirm',
  'safety',
  'firmware',
  'review',
];

export function deviceSetupStepOrder(machineKind: MachineKind): ReadonlyArray<DeviceSetupStep> {
  return machineKind === 'cnc' ? DEVICE_SETUP_STEP_ORDER : LASER_DEVICE_SETUP_STEP_ORDER;
}

export type DeviceSetupState = {
  readonly step: DeviceSetupStep;
  readonly machineKind: MachineKind;
  // The profile as the wizard opened: lets Finish diff against it and lets
  // Cancel mean "discard" (the draft is never written until Finish).
  readonly baseline: DeviceProfile;
  // The latest $$ observation. It stays separate from the draft until the
  // operator explicitly chooses Apply detected.
  readonly detected: Partial<DeviceProfile>;
  readonly detectedControllerKind: DeviceProfile['controllerKind'] | null;
  readonly controllerRead: boolean;
  // The working copy every editor mutates; committed on Finish.
  readonly draft: DeviceProfile;
  // True once a catalog preset was applied this session.
  readonly presetApplied: boolean;
  // Controller-reported values are committed only after the operator clicks
  // Apply detected; merely reading $$ must never alter the chosen profile.
  readonly detectedAccepted: boolean;
};

export type DeviceSetupAction =
  | { readonly kind: 'next' }
  | { readonly kind: 'back' }
  | { readonly kind: 'go'; readonly step: DeviceSetupStep }
  | { readonly kind: 'edit'; readonly patch: Partial<DeviceProfile> }
  | { readonly kind: 'apply-preset'; readonly profile: DeviceProfile }
  | { readonly kind: 'accept-detected'; readonly patch: Partial<DeviceProfile> }
  | {
      readonly kind: 'detected-updated';
      readonly detected?: Partial<DeviceProfile>;
      readonly detectedControllerKind?: DeviceProfile['controllerKind'] | null;
      readonly controllerRead?: boolean;
    };

export type DeviceSetupDetectedFacts = {
  readonly detectedControllerKind?: DeviceProfile['controllerKind'] | null;
  readonly controllerRead?: boolean;
  readonly machineKind?: MachineKind;
};

// Shared props for the wizard step components: the current flow state plus the
// reducer dispatch. ReviewStep takes only `state` (it makes no edits).
export type DeviceSetupStepProps = {
  readonly state: DeviceSetupState;
  readonly dispatch: Dispatch<DeviceSetupAction>;
};

export function initDeviceSetup(
  profile: DeviceProfile,
  detected: Partial<DeviceProfile> | null,
  facts: DeviceSetupDetectedFacts = {},
): DeviceSetupState {
  const safeDetected = detected ?? {};
  const machineKind = facts.machineKind ?? 'laser';
  const controllerRead =
    facts.controllerRead ?? (detected !== null || facts.detectedControllerKind !== undefined);
  const detectedControllerKind = facts.detectedControllerKind ?? null;
  return {
    step: 'connect',
    machineKind,
    baseline: profile,
    detected: safeDetected,
    detectedControllerKind,
    controllerRead,
    draft: profile,
    presetApplied: false,
    detectedAccepted: false,
  };
}

export function deviceSetupReducer(
  state: DeviceSetupState,
  action: DeviceSetupAction,
): DeviceSetupState {
  switch (action.kind) {
    case 'next':
      return { ...state, step: adjacentStep(state, 1) };
    case 'back':
      return { ...state, step: adjacentStep(state, -1) };
    case 'go':
      return deviceSetupStepOrder(state.machineKind).includes(action.step)
        ? { ...state, step: action.step }
        : state;
    case 'edit':
      return { ...state, draft: { ...state.draft, ...action.patch } };
    case 'accept-detected':
      return acceptDetected(state, action.patch);
    case 'apply-preset':
      return applyPreset(state, action.profile);
    case 'detected-updated':
      return updateDetectedFacts(state, action);
    default:
      return assertNever(action);
  }
}

function applyPreset(state: DeviceSetupState, profile: DeviceProfile): DeviceSetupState {
  return {
    ...state,
    draft: profile,
    presetApplied: true,
    detectedAccepted: false,
  };
}

function updateDetectedFacts(
  state: DeviceSetupState,
  action: Extract<DeviceSetupAction, { readonly kind: 'detected-updated' }>,
): DeviceSetupState {
  // The wizard re-dispatches the live $$ patch on every read; a ref-equal
  // dispatch (the mount re-sync) is a no-op so it does not force a render.
  if (
    (action.detected === undefined || action.detected === state.detected) &&
    action.detectedControllerKind === undefined &&
    action.controllerRead === undefined
  ) {
    return state;
  }
  const detectedControllerKind =
    action.detectedControllerKind === undefined
      ? state.detectedControllerKind
      : action.detectedControllerKind;
  return {
    ...state,
    detected: action.detected ?? state.detected,
    detectedControllerKind,
    controllerRead: action.controllerRead ?? true,
    draft: state.draft,
  };
}

function acceptDetected(state: DeviceSetupState, patch: Partial<DeviceProfile>): DeviceSetupState {
  return {
    ...state,
    draft: { ...state.draft, ...profilePatchForMachineKind(patch, state.machineKind) },
    detectedAccepted: true,
  };
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

// Next is allowed on the lead-in steps unconditionally (the operator may
// proceed to manual entry or skip the preset) and on the content steps only
// when the draft is structurally valid, so the wizard can't march toward
// Finish with an unusable profile. The final step shows Finish, not Next.
export function canAdvanceDeviceSetup(state: DeviceSetupState): boolean {
  switch (state.step) {
    case 'connect':
    case 'identify':
      return true;
    case 'confirm':
    case 'safety':
      return validateMachineProfile(state.draft).length === 0;
    case 'probe':
    case 'firmware':
      // Probing and firmware sync are optional — the operator can always
      // proceed (or skip).
      return true;
    case 'review':
      return false;
    default:
      return assertNever(state.step);
  }
}

export function isFirstDeviceSetupStep(step: DeviceSetupStep, machineKind: MachineKind): boolean {
  return step === deviceSetupStepOrder(machineKind)[0];
}

export function isLastDeviceSetupStep(step: DeviceSetupStep, machineKind: MachineKind): boolean {
  const order = deviceSetupStepOrder(machineKind);
  return step === order[order.length - 1];
}

function adjacentStep(state: DeviceSetupState, delta: number): DeviceSetupStep {
  const order = deviceSetupStepOrder(state.machineKind);
  const index = order.indexOf(state.step);
  if (index < 0) return order[0] ?? state.step;
  const clamped = Math.min(order.length - 1, Math.max(0, index + delta));
  return order[clamped] ?? state.step;
}

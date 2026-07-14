// device-setup-flow.ts — the pure state machine behind the connect-time
// Device Setup wizard (ADR-092). Owns the step order, Back/Next/jump
// navigation, and the working draft profile. No React, no store, no I/O: the
// wizard component drives it with useReducer so every transition is
// unit-testable in isolation.

import type { Dispatch } from 'react';
import {
  profileWithControllerFacts,
  validateMachineProfile,
  type DeviceProfile,
} from '../../../core/devices';
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
  // The latest $$ patch — seeded at open and refreshed via `detected-updated`
  // whenever the controller is (re-)read, so apply-preset and readiness overlay
  // current controller truth instead of a stale open-time snapshot.
  readonly detected: Partial<DeviceProfile>;
  readonly detectedControllerKind: DeviceProfile['controllerKind'] | null;
  readonly controllerRead: boolean;
  // The working copy every editor mutates; committed on Finish.
  readonly draft: DeviceProfile;
  // True once a catalog preset was applied this session.
  readonly presetApplied: boolean;
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
      readonly detected: Partial<DeviceProfile>;
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
  const controllerRead =
    facts.controllerRead ?? (detected !== null || facts.detectedControllerKind !== undefined);
  const detectedControllerKind = facts.detectedControllerKind ?? null;
  return {
    step: 'connect',
    machineKind: facts.machineKind ?? 'laser',
    baseline: profile,
    detected: safeDetected,
    detectedControllerKind,
    controllerRead,
    draft: {
      ...profile,
      ...safeDetected,
      ...(detectedControllerKind === null ? {} : { controllerKind: detectedControllerKind }),
    },
    presetApplied: false,
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
    case 'accept-detected':
      return { ...state, draft: { ...state.draft, ...action.patch } };
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
    draft: profileWithControllerFacts({
      profile,
      current: state.draft,
      detectedSettings: state.detected,
      controllerSettings: state.detected,
      detectedControllerKind: state.detectedControllerKind,
      lastSettingsReadAt: state.controllerRead ? 1 : null,
    }),
    presetApplied: true,
  };
}

function updateDetectedFacts(
  state: DeviceSetupState,
  action: Extract<DeviceSetupAction, { readonly kind: 'detected-updated' }>,
): DeviceSetupState {
  // The wizard re-dispatches the live $$ patch on every read; a ref-equal
  // dispatch (the mount re-sync) is a no-op so it does not force a render.
  if (
    action.detected === state.detected &&
    action.detectedControllerKind === undefined &&
    action.controllerRead === undefined
  ) {
    return state;
  }
  return {
    ...state,
    detected: action.detected,
    detectedControllerKind: action.detectedControllerKind ?? state.detectedControllerKind,
    controllerRead: action.controllerRead ?? true,
  };
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

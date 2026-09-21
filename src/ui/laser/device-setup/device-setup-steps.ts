import type { MachineKind } from '../../../core/scene';

export type DeviceSetupStep =
  | 'capability'
  | 'identify'
  | 'connect'
  | 'confirm'
  | 'cnc-setup'
  | 'options'
  | 'review';

export type DeviceSetupStage = 'identify' | 'confirm' | 'review';

export const DEVICE_SETUP_STEP_ORDER: ReadonlyArray<DeviceSetupStage> = [
  'identify',
  'confirm',
  'review',
];

export const CNC_DEVICE_SETUP_STEP_ORDER = DEVICE_SETUP_STEP_ORDER;

const DEVICE_SETUP_STEPS: ReadonlyArray<DeviceSetupStep> = [
  'capability',
  'identify',
  'connect',
  'confirm',
  'cnc-setup',
  'options',
  'review',
];

// Section IDs remain valid for existing recovery links and review Edit actions.
// Navigation groups them into three stages without discarding the section target.
export function deviceSetupStage(step: DeviceSetupStep): DeviceSetupStage {
  if (step === 'review') return 'review';
  if (step === 'confirm' || step === 'cnc-setup' || step === 'options') return 'confirm';
  return 'identify';
}

export function deviceSetupStepOrder(_machineKind: MachineKind): ReadonlyArray<DeviceSetupStage> {
  return DEVICE_SETUP_STEP_ORDER;
}

export function isDeviceSetupStep(value: string): value is DeviceSetupStep {
  return DEVICE_SETUP_STEPS.some((step) => step === value);
}

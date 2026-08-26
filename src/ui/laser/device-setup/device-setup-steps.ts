import type { MachineKind } from '../../../core/scene';

export type DeviceSetupStep =
  | 'capability'
  | 'identify'
  | 'connect'
  | 'confirm'
  | 'cnc-setup'
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

export const CNC_DEVICE_SETUP_STEP_ORDER: ReadonlyArray<DeviceSetupStep> = [
  'capability',
  'identify',
  'connect',
  'confirm',
  'cnc-setup',
  'options',
  'review',
];

const DEVICE_SETUP_STEPS: ReadonlyArray<DeviceSetupStep> = [
  ...new Set([...DEVICE_SETUP_STEP_ORDER, ...CNC_DEVICE_SETUP_STEP_ORDER]),
];

export function deviceSetupStepOrder(machineKind: MachineKind): ReadonlyArray<DeviceSetupStep> {
  return machineKind === 'cnc' ? CNC_DEVICE_SETUP_STEP_ORDER : DEVICE_SETUP_STEP_ORDER;
}

export function isDeviceSetupStep(value: string): value is DeviceSetupStep {
  return DEVICE_SETUP_STEPS.some((step) => step === value);
}

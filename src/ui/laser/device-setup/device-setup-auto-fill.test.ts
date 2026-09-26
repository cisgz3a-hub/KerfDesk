import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG } from '../../../core/scene';
import { nextAutoFill, planControllerAutoFill } from './device-setup-auto-fill';
import {
  deviceSetupReducer,
  initDeviceSetup,
  type DeviceSetupAction,
  type DeviceSetupState,
} from './device-setup-flow';

const REPORTED: Partial<DeviceProfile> = {
  bedWidth: 430,
  bedHeight: 390,
  maxFeed: 24000,
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
};

function reported(
  detected: Partial<DeviceProfile>,
  facts: Parameters<typeof initDeviceSetup>[2] = {},
): DeviceSetupState {
  return initDeviceSetup(DEFAULT_DEVICE_PROFILE, detected, {
    machine: LASER_MACHINE_CONFIG,
    controllerRead: true,
    ...facts,
  });
}

function report(state: DeviceSetupState, baudRate: number | null) {
  return { detected: state.detected, controllerKind: state.detectedControllerKind, baudRate };
}

function run(state: DeviceSetupState, actions: ReadonlyArray<DeviceSetupAction>) {
  return actions.reduce(deviceSetupReducer, state);
}

describe('planControllerAutoFill', () => {
  it('copies the reported work area, speed and power into the draft', () => {
    const state = reported(REPORTED);
    const plan = planControllerAutoFill(state, report(state, 115200));
    expect(plan?.summary).toEqual({
      controllerKind: null,
      baudRate: null,
      machineKind: null,
      values: true,
    });
    const filled = run(state, plan?.actions ?? []);
    expect(filled.draft).toMatchObject({ bedWidth: 430, bedHeight: 390, maxFeed: 24000 });
    expect(filled.detectedApplied).toBe(true);
  });

  it('adopts the firmware the banner named and keeps the baud that answered', () => {
    const state = reported(REPORTED, { detectedControllerKind: 'grblhal' });
    const plan = planControllerAutoFill(state, report(state, 230400));
    expect(plan?.summary).toMatchObject({ controllerKind: 'grblhal', baudRate: 230400 });
    const filled = run(state, plan?.actions ?? []);
    expect(filled.draft.controllerKind).toBe('grblhal');
    expect(filled.draft.baudRate).toBe(230400);
    // The reported S range survives the controller change's defaults.
    expect(filled.draft.maxPowerS).toBe(1000);
  });

  it('does not adopt a firmware that has no live link', () => {
    const state = reported(REPORTED, { detectedControllerKind: 'ruida' });
    expect(planControllerAutoFill(state, report(state, null))?.summary.controllerKind).toBeNull();
  });

  it('sets the machine type from laser mode, and leaves a two-tool machine alone', () => {
    const cnc = reported({ ...REPORTED, laserModeEnabled: false });
    const plan = planControllerAutoFill(cnc, report(cnc, null));
    expect(plan?.summary.machineKind).toBe('cnc');
    const filled = run(cnc, plan?.actions ?? []);
    expect(filled.machineKinds).toEqual(['cnc']);
    // A CNC draft keeps its spindle ceiling: $30 is not RPM without the explicit choice.
    expect(filled.cncDraft.params.spindleMaxRpm).toBe(
      DEFAULT_CNC_MACHINE_CONFIG.params.spindleMaxRpm,
    );

    const hybrid = deviceSetupReducer(cnc, {
      kind: 'set-machine-kinds',
      machineKinds: ['laser', 'cnc'],
    });
    expect(planControllerAutoFill(hybrid, report(hybrid, null))?.summary.machineKind).toBeNull();
  });

  it('plans nothing when the controller reported nothing new', () => {
    const state = reported({});
    expect(planControllerAutoFill(state, report(state, 115200))).toBeNull();
  });

  it('restores the draft it started from and keeps what the controller reported', () => {
    const state = reported(REPORTED, { detectedControllerKind: 'grblhal' });
    const filled = run(state, planControllerAutoFill(state, report(state, 115200))?.actions ?? []);
    const undone = deviceSetupReducer(filled, { kind: 'restore', state });
    expect(undone.draft).toEqual(state.draft);
    expect(undone.detected).toEqual(REPORTED);
    expect(undone.detectedControllerKind).toBe('grblhal');
    expect(undone.detectedApplied).toBe(false);
  });
});

describe('nextAutoFill', () => {
  it('fills on top of the first fill after a later read and keeps one Undo', () => {
    const state = reported(REPORTED);
    const first = nextAutoFill(state, null, { ...report(state, 230400), readAt: 1 });
    if (first === null) throw new Error('expected a first fill');
    const filled = run(state, first.actions);
    expect(filled.draft.baudRate).toBe(230400);
    // The same read does not fill twice.
    expect(nextAutoFill(filled, first.record, { ...report(filled, 230400), readAt: 1 })).toBeNull();

    const reread = {
      ...report(filled, 230400),
      detected: { ...REPORTED, bedWidth: 350 },
      readAt: 2,
    };
    const second = nextAutoFill(filled, first.record, reread);
    if (second === null || second.record.status !== 'applied') throw new Error('expected a refill');
    expect(run(filled, second.actions).draft.bedWidth).toBe(350);
    // Undo still restores the draft from before the first fill, and the
    // summary keeps the baud the first fill set.
    expect(second.record.undo).toBe(state);
    expect(second.record.summary.baudRate).toBe(230400);
  });

  it('fills nothing after Undo until the next Find', () => {
    const state = reported(REPORTED);
    expect(
      nextAutoFill(state, { status: 'undone' }, { ...report(state, 115200), readAt: 3 }),
    ).toBeNull();
  });
});

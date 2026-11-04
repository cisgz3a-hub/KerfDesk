import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG } from '../../../core/scene';
import { autoFilledRows, nextAutoFill, planControllerAutoFill } from './device-setup-auto-fill';
import {
  deviceSetupReducer,
  initDeviceSetup,
  type DeviceSetupAction,
  type DeviceSetupState,
} from './device-setup-flow';
import {
  chooseMachineEntryActions,
  machinePickerEntries,
  selectedMachineEntry,
} from './machine-picker-entries';

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

/** The first listed machine of `brand`, chosen as the operator would. */
function chooseListed(state: DeviceSetupState, brand: string): DeviceSetupState {
  const entry = machinePickerEntries(state).find((item) => item.brand === brand);
  if (entry === undefined) throw new Error(`No listed ${brand} machine`);
  return run(state, chooseMachineEntryActions(state, entry));
}

function chooseEntry(state: DeviceSetupState, id: string): DeviceSetupState {
  const entry = machinePickerEntries(state).find((item) => item.id === id);
  if (entry === undefined) throw new Error(`No listed machine ${id}`);
  return run(state, chooseMachineEntryActions(state, entry));
}

// Sculpfun's firmware sets $130=400 / $131=410 for the S30's 380 x 385 mm
// engraving area (brand-laser-profiles.ts).
const S30_FIRMWARE: Partial<DeviceProfile> = {
  bedWidth: 400,
  bedHeight: 410,
  maxFeed: 10000,
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
};

describe('planControllerAutoFill', () => {
  it('copies the reported work area, speed and power into the draft', () => {
    const state = reported(REPORTED);
    const plan = planControllerAutoFill(state, report(state, 115200));
    expect(plan?.summary).toEqual({
      controllerKind: null,
      baudRate: null,
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

  // UX audit U8-P2-1 (ADR-637 Amendment 7): stock GRBL ships with $32=0, so
  // laser mode off cannot tell a laser from a router. The generic laser starter
  // stays a laser that still expects laser mode on, so setup asks for $32=1.
  it('never sets the machine type from laser mode', () => {
    const laser = reported({ ...REPORTED, laserModeEnabled: false });
    const filled = run(laser, planControllerAutoFill(laser, report(laser, null))?.actions ?? []);
    expect(filled.machineKinds).toEqual(['laser']);
    expect(filled.draft.laserModeEnabled).toBe(true);
    expect(filled.draft).toMatchObject({ bedWidth: 430, bedHeight: 390, maxPowerS: 1000 });

    // A router chosen before Connect stays a router whatever $32 says, and
    // keeps its spindle ceiling: $30 is not RPM without the explicit choice.
    for (const laserModeEnabled of [false, true]) {
      const router = deviceSetupReducer(reported({ ...REPORTED, laserModeEnabled }), {
        kind: 'set-machine-kinds',
        machineKinds: ['cnc'],
      });
      const routerFilled = run(
        router,
        planControllerAutoFill(router, report(router, null))?.actions ?? [],
      );
      expect(routerFilled.machineKinds).toEqual(['cnc']);
      expect(routerFilled.cncDraft.params.spindleMaxRpm).toBe(
        DEFAULT_CNC_MACHINE_CONFIG.params.spindleMaxRpm,
      );
    }

    const hybrid = deviceSetupReducer(laser, {
      kind: 'set-machine-kinds',
      machineKinds: ['laser', 'cnc'],
    });
    expect(
      run(hybrid, planControllerAutoFill(hybrid, report(hybrid, null))?.actions ?? []).machineKinds,
    ).toEqual(['laser', 'cnc']);
  });

  // ADR-637 Amendment 1: $32 is a controller setting, not a measurement of the
  // machine (ADR-240 #2), so a machine chosen from the list keeps its type.
  // Amendment 7: a listed laser also keeps expecting laser mode on.
  it('keeps the type of a machine chosen from the list', () => {
    const ortur = chooseListed(reported({ ...REPORTED, laserModeEnabled: false }), 'Ortur');
    const filled = run(ortur, planControllerAutoFill(ortur, report(ortur, null))?.actions ?? []);
    expect(filled.machineKinds).toEqual(['laser']);
    expect(filled.draft.laserModeEnabled).toBe(true);
    expect(selectedMachineEntry(filled, machinePickerEntries(filled))?.brand).toBe('Ortur');

    const router = chooseListed(reported(REPORTED), 'Genmitsu');
    const routerPlan = planControllerAutoFill(router, report(router, null));
    expect(run(router, routerPlan?.actions ?? []).machineKinds).toEqual(['cnc']);
  });

  // ADR-637 Amendment 2 (controller audit v4 E2-P2-1): $130/$131 are the
  // controller's travel, not the bed, so a listed machine keeps its sourced
  // work area and stays the chosen row.
  it('keeps the sourced work area of a machine chosen from the list', () => {
    const s30 = chooseEntry(reported(S30_FIRMWARE), 'sculpfun-s30');
    expect(s30.draft).toMatchObject({ bedWidth: 380, bedHeight: 385 });
    const plan = planControllerAutoFill(s30, report(s30, null));
    expect(plan?.summary.values).toBe(true);
    const filled = run(s30, plan?.actions ?? []);
    expect(filled.draft).toMatchObject({ bedWidth: 380, bedHeight: 385, maxFeed: 10000 });
    // The observation is kept for Review's travel comparison.
    expect(filled.detected).toMatchObject({ bedWidth: 400, bedHeight: 410 });
    expect(selectedMachineEntry(filled, machinePickerEntries(filled))?.id).toBe('sculpfun-s30');

    // A CNC preset is chosen while its work area holds, so it stays chosen too.
    const router = chooseListed(reported(REPORTED), 'Genmitsu');
    const routerArea = { bedWidth: router.draft.bedWidth, bedHeight: router.draft.bedHeight };
    const routerFilled = run(
      router,
      planControllerAutoFill(router, report(router, null))?.actions ?? [],
    );
    expect(routerFilled.draft).toMatchObject(routerArea);
    expect(selectedMachineEntry(routerFilled, machinePickerEntries(routerFilled))?.brand).toBe(
      'Genmitsu',
    );
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

  // The other order: the toolbar's first Connect fills the starter, then the
  // operator chooses the S30, then a later read (Read again) fills on top.
  it('keeps a listed work area chosen after the first fill when a later read fills again', () => {
    const state = reported(S30_FIRMWARE);
    const first = nextAutoFill(state, null, { ...report(state, null), readAt: 1 });
    if (first === null) throw new Error('expected a first fill');
    const starter = run(state, first.actions);
    // The starter is not listed, so it takes the controller's travel.
    expect(starter.draft).toMatchObject({ bedWidth: 400, bedHeight: 410 });

    const s30 = chooseEntry(starter, 'sculpfun-s30');
    const second = nextAutoFill(s30, first.record, { ...report(s30, null), readAt: 2 });
    if (second === null) throw new Error('expected a refill');
    expect(run(s30, second.actions).draft).toMatchObject({ bedWidth: 380, bedHeight: 385 });
  });

  // Controller audit v4 E2-P3-1: the card lists only what a fill wrote and the
  // draft still holds, never a machine's values chosen after the fill.
  it('lists only the values a fill wrote that the draft still holds', () => {
    const state = reported(S30_FIRMWARE);
    const first = nextAutoFill(state, null, { ...report(state, null), readAt: 1 });
    if (first === null || first.record.status !== 'applied') throw new Error('expected a fill');
    const filled = run(state, first.actions);
    // The 400 × 400 starter takes the reported 410 mm height.
    expect(autoFilledRows(first.record, filled).map((row) => row.label)).toEqual(
      expect.arrayContaining(['Bed height', 'Max feed']),
    );

    // Choosing the S30 replaces the filled work area with the listed one:
    // neither 380 nor 385 came from the controller.
    const s30 = chooseEntry(filled, 'sculpfun-s30');
    const labels = autoFilledRows(first.record, s30).map((row) => row.label);
    expect(labels).not.toContain('Bed width');
    expect(labels).not.toContain('Bed height');
  });

  it('fills nothing after Undo until the next Find', () => {
    const state = reported(REPORTED);
    expect(
      nextAutoFill(state, { status: 'undone' }, { ...report(state, 115200), readAt: 3 }),
    ).toBeNull();
  });
});

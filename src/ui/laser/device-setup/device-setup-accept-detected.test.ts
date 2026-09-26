// The controller reports one max rate ($110/$111), but the laser and CNC keep
// their own Max feed (ADR-416). Use detected values and Find my machine's fill
// must put it where the head that runs the job reads it: CNC jobs read
// CncMachineParams.maxFeedMmPerMin, so a value left only on the device
// profile never reached them.

import { describe, expect, it } from 'vitest';
import { cncMaxFeedMmPerMin } from '../../../core/cnc/cnc-head-feeds';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  LASER_MACHINE_CONFIG,
  type MachineKind,
} from '../../../core/scene';
import { setupChangeRows } from './device-setup-accept-detected';
import { planControllerAutoFill } from './device-setup-auto-fill';
import {
  deviceSetupReducer,
  initDeviceSetup,
  machineSetupProfile,
  type DeviceSetupState,
} from './device-setup-flow';

const REPORTED_FEED = 12_000;

function setup(machineKinds: readonly [MachineKind, ...MachineKind[]]): DeviceSetupState {
  const opened = initDeviceSetup(
    { ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000 },
    { maxFeed: REPORTED_FEED },
    {
      machine: machineKinds[0] === 'cnc' ? DEFAULT_CNC_MACHINE_CONFIG : LASER_MACHINE_CONFIG,
      controllerRead: true,
    },
  );
  const state = deviceSetupReducer(opened, { kind: 'set-machine-kinds', machineKinds });
  // CNC's own speed is set, as the split freezes it when a CNC setup is made.
  return deviceSetupReducer(state, {
    kind: 'edit-machine',
    machine: {
      ...state.cncDraft,
      params: { ...state.cncDraft.params, maxFeedMmPerMin: 3000 },
    },
  });
}

function accept(state: DeviceSetupState, patch: Partial<DeviceProfile>): DeviceSetupState {
  return deviceSetupReducer(state, { kind: 'accept-detected', patch });
}

function cncFeed(state: DeviceSetupState): number {
  return cncMaxFeedMmPerMin(state.draft, state.cncDraft.params);
}

describe('accepting the controller max rate per head', () => {
  it('fills the laser Max feed on a laser setup and leaves the router alone', () => {
    const state = setup(['laser']);
    const accepted = accept(state, { maxFeed: REPORTED_FEED });
    expect(accepted.draft.maxFeed).toBe(REPORTED_FEED);
    expect(accepted.cncDraft.params.maxFeedMmPerMin).toBe(3000);
    expect(setupChangeRows(state, accepted).map((row) => row.label)).toEqual(['Max feed']);
  });

  it("fills CNC's own Max feed on a CNC setup, where CNC jobs read it", () => {
    const state = setup(['cnc']);
    const accepted = accept(state, { maxFeed: REPORTED_FEED });
    expect(cncFeed(accepted)).toBe(REPORTED_FEED);
    if (accepted.draftMachine.kind !== 'cnc') throw new Error('expected CNC draft');
    expect(accepted.draftMachine.params.maxFeedMmPerMin).toBe(REPORTED_FEED);
    // The device profile's Max feed is the laser's, and this machine has none.
    expect(accepted.draft.maxFeed).toBe(6000);
    expect(machineSetupProfile(accepted).cncSubProfile?.maxFeedMmPerMin).toBe(REPORTED_FEED);
    expect(setupChangeRows(state, accepted)).toEqual([
      { label: 'CNC max feed', oldText: '3000 mm/min', newText: '12000 mm/min', changed: true },
    ]);
  });

  it('fills both heads on a laser + CNC machine and names each', () => {
    const state = setup(['laser', 'cnc']);
    const accepted = accept(state, { maxFeed: REPORTED_FEED });
    expect(accepted.draft.maxFeed).toBe(REPORTED_FEED);
    expect(cncFeed(accepted)).toBe(REPORTED_FEED);
    expect(setupChangeRows(state, accepted).map((row) => row.label)).toEqual([
      'Laser max feed',
      'CNC max feed',
    ]);
  });

  it('shows no row once both heads already match the controller', () => {
    const state = accept(setup(['laser', 'cnc']), { maxFeed: REPORTED_FEED });
    expect(setupChangeRows(state, accept(state, { maxFeed: REPORTED_FEED }))).toEqual([]);
  });

  it("Find my machine's fill of a new router lands on CNC's own Max feed", () => {
    const state = initDeviceSetup(
      { ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000 },
      { maxFeed: REPORTED_FEED, laserModeEnabled: false },
      { machine: LASER_MACHINE_CONFIG, controllerRead: true },
    );
    const plan = planControllerAutoFill(state, {
      detected: state.detected,
      controllerKind: null,
      baudRate: null,
    });
    const filled = (plan?.actions ?? []).reduce(deviceSetupReducer, state);
    expect(filled.machineKinds).toEqual(['cnc']);
    expect(cncFeed(filled)).toBe(REPORTED_FEED);
    expect(filled.cncDraft.params.maxFeedMmPerMin).toBe(REPORTED_FEED);
    expect(setupChangeRows(state, filled).map((row) => row.label)).toContain('CNC max feed');
  });
});

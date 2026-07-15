import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  GRBL_MACHINE_PROFILE_CATALOG,
  type DeviceProfile,
} from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG } from '../../../core/scene';
import {
  canAdvanceDeviceSetup,
  DEVICE_SETUP_STEP_ORDER,
  deviceSetupReducer,
  initDeviceSetup,
  machineSetupProfile,
  machineSetupValidationIssues,
  type DeviceSetupState,
} from './device-setup-flow';

function open(detected: Partial<DeviceProfile> | null = null): DeviceSetupState {
  return initDeviceSetup(DEFAULT_DEVICE_PROFILE, detected, { machine: LASER_MACHINE_CONFIG });
}

describe('unified machine setup flow', () => {
  it('starts with machine/controller selection before connection', () => {
    const state = open();
    expect(state.step).toBe('identify');
    expect(DEVICE_SETUP_STEP_ORDER).toEqual([
      'identify',
      'connect',
      'confirm',
      'machine',
      'safety',
      'firmware',
      'review',
    ]);
  });

  it('walks the same beginner sequence for laser and CNC without running a probe', () => {
    let state = open();
    for (const step of DEVICE_SETUP_STEP_ORDER.slice(1)) {
      state = deviceSetupReducer(state, { kind: 'next' });
      expect(state.step).toBe(step);
    }
    expect(DEVICE_SETUP_STEP_ORDER).not.toContain('probe');
  });

  it('keeps DeviceProfile and CNC config in the same draft', () => {
    let state = open();
    state = deviceSetupReducer(state, { kind: 'set-machine-kinds', machineKinds: ['cnc'] });
    expect(state.draftMachine).toEqual(DEFAULT_CNC_MACHINE_CONFIG);
    if (state.draftMachine.kind !== 'cnc') throw new Error('expected CNC draft');
    const machine = {
      ...state.draftMachine,
      params: { ...state.draftMachine.params, safeZMm: 8, spindleMaxRpm: 18000 },
    };
    state = deviceSetupReducer(state, { kind: 'edit-machine', machine });
    state = deviceSetupReducer(state, { kind: 'edit', patch: { bedWidth: 610 } });
    expect(state.draft.bedWidth).toBe(610);
    expect(state.draftMachine.kind).toBe('cnc');
    if (state.draftMachine.kind === 'cnc') expect(state.draftMachine.params.safeZMm).toBe(8);
  });

  it('retains CNC values when switching machine types during setup', () => {
    let state = initDeviceSetup(DEFAULT_DEVICE_PROFILE, null, {
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, safeZMm: 12 },
      },
    });
    state = deviceSetupReducer(state, {
      kind: 'set-machine-kinds',
      machineKinds: ['laser', 'cnc'],
    });
    state = deviceSetupReducer(state, { kind: 'select-machine-kind', machineKind: 'laser' });
    state = deviceSetupReducer(state, { kind: 'select-machine-kind', machineKind: 'cnc' });
    expect(state.draftMachine.kind).toBe('cnc');
    if (state.draftMachine.kind === 'cnc') expect(state.draftMachine.params.safeZMm).toBe(12);
  });

  it('selects a compatible controller contract and resets stale baud', () => {
    const state = deviceSetupReducer(open(), {
      kind: 'select-controller',
      controllerKind: 'marlin',
    });
    expect(state.draft).toMatchObject({
      controllerKind: 'marlin',
      baudRate: 250000,
      maxPowerS: 255,
      streamingMode: 'ping-pong',
      gcodeDialect: { dialectId: 'marlin-inline' },
    });
  });

  it('blocks unsupported CNC/controller combinations', () => {
    let state = deviceSetupReducer(open(), {
      kind: 'set-machine-kinds',
      machineKinds: ['cnc'],
    });
    state = deviceSetupReducer(state, { kind: 'select-controller', controllerKind: 'marlin' });
    expect(machineSetupValidationIssues(state).join(' ')).toMatch(/cannot run KerfDesk CNC jobs/);
    expect(canAdvanceDeviceSetup(state)).toBe(false);
  });

  it('persists both output capabilities and CNC machine values for a hybrid machine', () => {
    let state = deviceSetupReducer(open(), {
      kind: 'set-machine-kinds',
      machineKinds: ['laser', 'cnc'],
    });
    const machine = {
      ...state.cncDraft,
      params: { ...state.cncDraft.params, safeZMm: 11, spindleMaxRpm: 24000 },
    };
    state = deviceSetupReducer(state, { kind: 'edit-machine', machine });
    const profile = machineSetupProfile(state);
    expect(profile.capabilities).toEqual(expect.arrayContaining(['laser-output', 'cnc-output']));
    expect(profile.cncSubProfile).toMatchObject({ safeZMm: 11, spindleMaxRpm: 24000 });
    expect(state.machineKind).toBe('laser');
    expect(state.draftMachine).toEqual(LASER_MACHINE_CONFIG);
  });

  it('keeps readback separate until the operator explicitly accepts it', () => {
    const state = initDeviceSetup(
      DEFAULT_DEVICE_PROFILE,
      { bedWidth: 600, maxPowerS: 255 },
      {
        machine: LASER_MACHINE_CONFIG,
        controllerRead: true,
      },
    );
    expect(state.draft).toEqual(DEFAULT_DEVICE_PROFILE);
    expect(state.detected).toEqual({ bedWidth: 600, maxPowerS: 255 });
  });

  it('does not rewrite a user-selected profile when controller identity arrives', () => {
    const state = deviceSetupReducer(open(), {
      kind: 'detected-updated',
      detected: {},
      detectedControllerKind: 'grblhal',
      controllerRead: false,
    });
    expect(state.detectedControllerKind).toBe('grblhal');
    expect(state.draft).toEqual(DEFAULT_DEVICE_PROFILE);
    expect(state.controllerRead).toBe(false);
  });

  it('applies a catalog preset exactly without layering detected values over it', () => {
    const preset = GRBL_MACHINE_PROFILE_CATALOG.find(
      (entry) => entry.profile.profileId !== DEFAULT_DEVICE_PROFILE.profileId,
    )?.profile;
    if (preset === undefined) throw new Error('catalog preset missing');
    const before = open({ maxPowerS: 255 });
    const state = deviceSetupReducer(before, { kind: 'apply-preset', profile: preset });
    expect(state.draft).toEqual(preset);
    expect(before.draft).toEqual(DEFAULT_DEVICE_PROFILE);
  });

  it('routes accepted CNC $30 readback to spindle ceiling, not laser power', () => {
    let state = initDeviceSetup(
      DEFAULT_DEVICE_PROFILE,
      { maxPowerS: 24000, bedWidth: 610 },
      {
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        controllerRead: true,
      },
    );
    state = deviceSetupReducer(state, {
      kind: 'accept-detected',
      patch: { maxPowerS: 24000, minPowerS: 80, laserModeEnabled: true, bedWidth: 610 },
    });
    expect(state.draft.maxPowerS).toBe(DEFAULT_DEVICE_PROFILE.maxPowerS);
    expect(state.draft.minPowerS).toBe(DEFAULT_DEVICE_PROFILE.minPowerS);
    expect(state.draft.laserModeEnabled).toBe(DEFAULT_DEVICE_PROFILE.laserModeEnabled);
    expect(state.draft.bedWidth).toBe(610);
    if (state.draftMachine.kind !== 'cnc') throw new Error('expected CNC draft');
    expect(state.draftMachine.params.spindleMaxRpm).toBe(24000);
  });

  it('keeps apply confirmation through duplicate detected syncs and clears it for new values', () => {
    let state = initDeviceSetup(
      DEFAULT_DEVICE_PROFILE,
      { bedWidth: 610 },
      { controllerRead: true },
    );
    state = deviceSetupReducer(state, {
      kind: 'accept-detected',
      patch: { bedWidth: 610 },
    });
    expect(state.detectedApplied).toBe(true);

    state = deviceSetupReducer(state, {
      kind: 'detected-updated',
      detected: { bedWidth: 610 },
      controllerRead: true,
    });
    expect(state.detectedApplied).toBe(true);

    state = deviceSetupReducer(state, {
      kind: 'detected-updated',
      detected: { bedWidth: 611 },
      controllerRead: true,
    });
    expect(state.detectedApplied).toBe(false);
  });

  it('blocks invalid geometry but leaves connect and firmware optional', () => {
    let state = deviceSetupReducer(open(), { kind: 'edit', patch: { bedWidth: 0 } });
    expect(canAdvanceDeviceSetup(state)).toBe(false);
    state = deviceSetupReducer(state, { kind: 'go', step: 'connect' });
    expect(canAdvanceDeviceSetup(state)).toBe(true);
    state = deviceSetupReducer(state, { kind: 'go', step: 'firmware' });
    expect(canAdvanceDeviceSetup(state)).toBe(true);
  });

  it('keeps firmware writes queued in the draft and clears them when the contract changes', () => {
    let state = deviceSetupReducer(open(), {
      kind: 'set-firmware-backup-confirmed',
      confirmed: true,
    });
    state = deviceSetupReducer(state, { kind: 'toggle-firmware-write', id: 30 });
    expect(state.queuedFirmwareWriteIds).toEqual([30]);
    state = deviceSetupReducer(state, { kind: 'select-controller', controllerKind: 'grblhal' });
    expect(state.firmwareBackupConfirmed).toBe(false);
    expect(state.queuedFirmwareWriteIds).toEqual([]);
  });

  it('invalidates backup attestation and queued writes when a confirmed value changes', () => {
    let state = deviceSetupReducer(open(), {
      kind: 'set-firmware-backup-confirmed',
      confirmed: true,
    });
    state = deviceSetupReducer(state, { kind: 'toggle-firmware-write', id: 30 });
    state = deviceSetupReducer(state, { kind: 'edit', patch: { maxPowerS: 900 } });
    expect(state.firmwareBackupConfirmed).toBe(false);
    expect(state.queuedFirmwareWriteIds).toEqual([]);
  });
});

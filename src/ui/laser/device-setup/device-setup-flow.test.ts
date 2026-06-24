import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  GRBL_MACHINE_PROFILE_CATALOG,
  type DeviceProfile,
} from '../../../core/devices';
import {
  canAdvanceDeviceSetup,
  DEVICE_SETUP_STEP_ORDER,
  deviceSetupReducer,
  initDeviceSetup,
  isFirstDeviceSetupStep,
  isLastDeviceSetupStep,
  type DeviceSetupState,
} from './device-setup-flow';

const PROFILE = DEFAULT_DEVICE_PROFILE;

function open(detected: Partial<DeviceProfile> | null = null): DeviceSetupState {
  return initDeviceSetup(PROFILE, detected);
}

function nonDefaultPreset(): DeviceProfile {
  const preset = GRBL_MACHINE_PROFILE_CATALOG.find(
    (candidate) => candidate.profile.profileId !== DEFAULT_DEVICE_PROFILE.profileId,
  )?.profile;
  if (preset === undefined) throw new Error('catalog has no non-default preset');
  return preset;
}

describe('initDeviceSetup', () => {
  it('starts on the connect step with the draft equal to the profile when nothing is detected', () => {
    const state = open();
    expect(state.step).toBe('connect');
    expect(state.draft).toEqual(PROFILE);
    expect(state.baseline).toEqual(PROFILE);
    expect(state.presetApplied).toBe(false);
  });

  it('overlays the detected patch onto the draft but leaves the baseline untouched', () => {
    const state = open({ bedWidth: 600, maxPowerS: 255 });
    expect(state.draft.bedWidth).toBe(600);
    expect(state.draft.maxPowerS).toBe(255);
    expect(state.baseline.bedWidth).toBe(PROFILE.bedWidth);
  });
});

describe('deviceSetupReducer navigation', () => {
  it('walks next through the whole step order and clamps at the last step', () => {
    let state = open();
    for (const expected of DEVICE_SETUP_STEP_ORDER.slice(1)) {
      state = deviceSetupReducer(state, { kind: 'next' });
      expect(state.step).toBe(expected);
    }
    expect(isLastDeviceSetupStep(state.step)).toBe(true);
    const atLast = state.step;
    state = deviceSetupReducer(state, { kind: 'next' });
    expect(state.step).toBe(atLast);
  });

  it('walks back to the first step and clamps there', () => {
    let state = deviceSetupReducer(open(), { kind: 'go', step: 'review' });
    while (!isFirstDeviceSetupStep(state.step)) {
      state = deviceSetupReducer(state, { kind: 'back' });
    }
    expect(state.step).toBe('connect');
    state = deviceSetupReducer(state, { kind: 'back' });
    expect(state.step).toBe('connect');
  });

  it('jumps to an arbitrary step with go', () => {
    expect(deviceSetupReducer(open(), { kind: 'go', step: 'safety' }).step).toBe('safety');
  });
});

describe('deviceSetupReducer draft edits', () => {
  it('merges edit and accept-detected patches immutably', () => {
    const start = open();
    const edited = deviceSetupReducer(start, { kind: 'edit', patch: { name: 'My Laser' } });
    expect(edited.draft.name).toBe('My Laser');
    expect(start.draft.name).toBe(PROFILE.name);
    const accepted = deviceSetupReducer(edited, {
      kind: 'accept-detected',
      patch: { bedWidth: 500 },
    });
    expect(accepted.draft.bedWidth).toBe(500);
    expect(accepted.draft.name).toBe('My Laser');
  });

  it('applies a preset but keeps controller-detected values layered on top', () => {
    const preset = nonDefaultPreset();
    const before = open({ maxPowerS: 255 });
    const state = deviceSetupReducer(before, { kind: 'apply-preset', profile: preset });
    expect(state.presetApplied).toBe(true);
    expect(state.draft.profileId).toBe(preset.profileId);
    expect(state.draft.maxPowerS).toBe(255);
    // the input state is not mutated (draft-and-commit immutability)
    expect(before.presetApplied).toBe(false);
    expect(before.draft.profileId).toBe(PROFILE.profileId);
  });
});

describe('canAdvanceDeviceSetup', () => {
  it('always allows advancing from the lead-in and optional steps', () => {
    expect(canAdvanceDeviceSetup(open())).toBe(true);
    expect(
      canAdvanceDeviceSetup(deviceSetupReducer(open(), { kind: 'go', step: 'identify' })),
    ).toBe(true);
    // the firmware-sync step is optional — always advanceable (or skippable)
    expect(
      canAdvanceDeviceSetup(deviceSetupReducer(open(), { kind: 'go', step: 'firmware' })),
    ).toBe(true);
  });

  it('blocks advancing from a content step when the draft is invalid', () => {
    const onConfirm = deviceSetupReducer(open(), { kind: 'go', step: 'confirm' });
    expect(canAdvanceDeviceSetup(onConfirm)).toBe(true);
    const broken = deviceSetupReducer(onConfirm, { kind: 'edit', patch: { bedWidth: 0 } });
    expect(canAdvanceDeviceSetup(broken)).toBe(false);
    // the safety step shares the same validity gate
    expect(canAdvanceDeviceSetup(deviceSetupReducer(broken, { kind: 'go', step: 'safety' }))).toBe(
      false,
    );
  });

  it('does not offer Next on the final review step', () => {
    expect(canAdvanceDeviceSetup(deviceSetupReducer(open(), { kind: 'go', step: 'review' }))).toBe(
      false,
    );
  });
});

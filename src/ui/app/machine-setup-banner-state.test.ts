import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { deviceProfileSignature } from '../laser/device-setup/device-setup-nudge';
import { isStarterMachine, machineSetupBannerState } from './machine-setup-banner-state';

const NOTHING_SAVED = { configured: new Set<string>(), lastMachine: null, dismissed: false };

describe('when the machine setup banner shows (ADR-500)', () => {
  it('shows on the starter machine exactly as it ships', () => {
    expect(isStarterMachine(DEFAULT_DEVICE_PROFILE)).toBe(true);
    expect(isStarterMachine({ ...DEFAULT_DEVICE_PROFILE })).toBe(true);
    expect(machineSetupBannerState({ ...NOTHING_SAVED, device: DEFAULT_DEVICE_PROFILE })).toEqual({
      kind: 'first-run',
    });
  });

  it('hides once the machine is anything else, or the starter was edited', () => {
    for (const device of [
      FALCON_A1_PRO_GRBLHAL_PROFILE,
      { ...DEFAULT_DEVICE_PROFILE, bedWidth: 300 },
      { ...DEFAULT_DEVICE_PROFILE, name: 'My 400' },
    ]) {
      expect(isStarterMachine(device)).toBe(false);
      expect(machineSetupBannerState({ ...NOTHING_SAVED, device }).kind).toBe('hidden');
    }
  });

  it('hides when the starter machine itself was set up, as a laser or a CNC', () => {
    for (const kind of ['laser', 'cnc'] as const) {
      const configured = new Set([deviceProfileSignature(DEFAULT_DEVICE_PROFILE, kind)]);
      expect(
        machineSetupBannerState({ ...NOTHING_SAVED, configured, device: DEFAULT_DEVICE_PROFILE })
          .kind,
      ).toBe('hidden');
    }
  });

  it('offers the last machine saved in Machine Setup', () => {
    const configured = new Set([deviceProfileSignature(FALCON_A1_PRO_GRBLHAL_PROFILE)]);
    expect(
      machineSetupBannerState({
        configured,
        lastMachine: FALCON_A1_PRO_GRBLHAL_PROFILE,
        dismissed: false,
        device: DEFAULT_DEVICE_PROFILE,
      }),
    ).toEqual({ kind: 'last-machine', machine: FALCON_A1_PRO_GRBLHAL_PROFILE });
    expect(
      machineSetupBannerState({
        ...NOTHING_SAVED,
        lastMachine: DEFAULT_DEVICE_PROFILE,
        device: DEFAULT_DEVICE_PROFILE,
      }),
    ).toEqual({ kind: 'first-run' });
  });

  it('hides for the rest of the session after Not now', () => {
    expect(
      machineSetupBannerState({ ...NOTHING_SAVED, dismissed: true, device: DEFAULT_DEVICE_PROFILE })
        .kind,
    ).toBe('hidden');
  });
});

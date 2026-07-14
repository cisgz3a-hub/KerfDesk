import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import { deviceProfileSignature, shouldPromptDeviceSetup } from './device-setup-nudge';

describe('deviceProfileSignature', () => {
  it('keys on profile id, bed dimensions, and controller kind', () => {
    expect(deviceProfileSignature(DEFAULT_DEVICE_PROFILE)).toBe(
      'generic-grbl-400x400:400x400:grbl-v1.1',
    );
  });

  it('changes when the bed changes', () => {
    const resized: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, bedWidth: 500 };
    expect(deviceProfileSignature(resized)).not.toBe(
      deviceProfileSignature(DEFAULT_DEVICE_PROFILE),
    );
  });

  it('falls back to the name when no profileId is set', () => {
    const { profileId: _omit, ...rest } = DEFAULT_DEVICE_PROFILE;
    void _omit;
    const named: DeviceProfile = { ...rest, name: 'Bench Laser' };
    expect(deviceProfileSignature(named)).toBe('Bench Laser:400x400:grbl-v1.1');
  });

  it('changes when the controller kind changes', () => {
    expect(
      deviceProfileSignature({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grblhal' }),
    ).not.toBe(deviceProfileSignature(DEFAULT_DEVICE_PROFILE));
  });
});

describe('shouldPromptDeviceSetup', () => {
  const configuredOf = (profile: DeviceProfile): ReadonlySet<string> =>
    new Set([deviceProfileSignature(profile)]);

  it('does not prompt when disconnected', () => {
    expect(
      shouldPromptDeviceSetup({
        connected: false,
        device: DEFAULT_DEVICE_PROFILE,
        configured: new Set(),
      }),
    ).toBe(false);
  });

  it('prompts when connected to an unconfigured profile', () => {
    expect(
      shouldPromptDeviceSetup({
        connected: true,
        device: DEFAULT_DEVICE_PROFILE,
        configured: new Set(),
      }),
    ).toBe(true);
  });

  it('does not prompt once the active profile has been configured', () => {
    expect(
      shouldPromptDeviceSetup({
        connected: true,
        device: DEFAULT_DEVICE_PROFILE,
        configured: configuredOf(DEFAULT_DEVICE_PROFILE),
      }),
    ).toBe(false);
  });

  it('prompts again when the configured profile is edited to a new signature', () => {
    const resized: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, bedWidth: 500 };
    expect(
      shouldPromptDeviceSetup({
        connected: true,
        device: resized,
        configured: configuredOf(DEFAULT_DEVICE_PROFILE),
      }),
    ).toBe(true);
  });
});

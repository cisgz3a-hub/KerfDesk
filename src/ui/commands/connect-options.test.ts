import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { connectOptionsForDevice, hasFileOnlyTransport } from './connect-options';

describe('hasFileOnlyTransport', () => {
  it('marks the Ruida .rd export profile file-only and a GRBL profile not', () => {
    const ruida = profileCatalogEntryById('generic-ruida-rd-export');
    if (ruida === undefined) throw new Error('missing generic Ruida profile');
    expect(hasFileOnlyTransport(ruida.profile)).toBe(true);
    expect(hasFileOnlyTransport(DEFAULT_DEVICE_PROFILE)).toBe(false);
  });
});

describe('connectOptionsForDevice', () => {
  it.each([true, false])('preserves the explicit background streaming choice %s', (enabled) => {
    expect(
      connectOptionsForDevice({ ...DEFAULT_DEVICE_PROFILE, workerHostedStreaming: enabled })
        .hostedStreaming,
    ).toBe(enabled);
  });
  it('carries a vendor command contract to menu connections', () => {
    expect(
      connectOptionsForDevice({
        ...DEFAULT_DEVICE_PROFILE,
        controllerCommandSet: 'creality-falcon-a1-pro',
      }).controllerCommandSet,
    ).toBe('creality-falcon-a1-pro');
  });
  it('carries a Marlin profile controllerKind + baud instead of the GRBL 115200 default', () => {
    const marlin = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin' as const,
      baudRate: 250000,
    };
    expect(connectOptionsForDevice(marlin)).toEqual({ controllerKind: 'marlin', baudRate: 250000 });
  });

  it('passes through the configured profile fields verbatim', () => {
    expect(connectOptionsForDevice(DEFAULT_DEVICE_PROFILE)).toEqual({
      controllerKind: DEFAULT_DEVICE_PROFILE.controllerKind,
      baudRate: DEFAULT_DEVICE_PROFILE.baudRate,
    });
  });
});

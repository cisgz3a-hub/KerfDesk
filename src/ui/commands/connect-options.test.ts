import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { connectOptionsForDevice } from './connect-options';

describe('connectOptionsForDevice', () => {
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

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { profileLayerDefaultSettings } from './profile-layer-default-settings';

const PROJECT = { device: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE };

describe('proposed profileLayerDefaultSettings', () => {
  it('retains the authored Line and Fill values for the exact laser profile', () => {
    expect(profileLayerDefaultSettings(PROJECT, 'line')).toEqual({
      speed: 800,
      power: 90,
      fillBidirectional: false,
    });
    expect(profileLayerDefaultSettings(PROJECT, 'fill')).toEqual({
      speed: 800,
      power: 80,
      fillBidirectional: false,
    });
  });

  it.each(['line', 'fill', 'image'] as const)('does not add %s defaults in CNC mode', (mode) => {
    expect(
      profileLayerDefaultSettings({ ...PROJECT, machine: DEFAULT_CNC_MACHINE_CONFIG }, mode),
    ).toEqual({});
  });

  it('does not infer the profile from a copied name or bed size', () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      name: PROJECT.device.name,
      bedWidth: 400,
      bedHeight: 400,
    };
    expect(profileLayerDefaultSettings({ device }, 'line')).toEqual({});
    expect(profileLayerDefaultSettings({ device }, 'fill')).toEqual({});
  });

  it('excludes Image mode even when saved fields are supplied', () => {
    expect(profileLayerDefaultSettings(PROJECT, 'image', { speed: 975, power: 63 })).toEqual({});
  });

  it('honors saved zero and false values without copying unrelated settings', () => {
    expect(
      profileLayerDefaultSettings(PROJECT, 'fill', {
        speed: 975,
        power: 0,
        fillBidirectional: false,
        passes: 99,
        visible: false,
      }),
    ).toEqual({ speed: 975, power: 0, fillBidirectional: false });
  });
});

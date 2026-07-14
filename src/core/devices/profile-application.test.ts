import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';
import { profileWithControllerFactsResult } from './profile-application';

describe('profileWithControllerFactsResult', () => {
  it('keeps controller-reported machine limits while normalizing a cross-family profile', () => {
    const marlinProfile: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      name: 'Marlin fixture',
      controllerKind: 'marlin',
      streamingMode: 'ping-pong',
      gcodeDialect: { dialectId: 'marlin-inline' },
      bedWidth: 300,
      maxFeed: 3000,
    };
    const current: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'grblhal',
      bedWidth: 410,
      maxFeed: 9000,
      framingFeedMmPerMin: 8000,
    };

    const result = profileWithControllerFactsResult({
      profile: marlinProfile,
      current,
      detectedSettings: { bedWidth: 420, maxFeed: 10000 },
      controllerSettings: { bedHeight: 415 },
      detectedControllerKind: 'grblhal',
      lastSettingsReadAt: 1,
    });

    expect(result.profile).toMatchObject({
      controllerKind: 'grblhal',
      streamingMode: 'char-counted',
      gcodeDialect: { dialectId: 'grbl-dynamic' },
      bedWidth: 420,
      bedHeight: 415,
      maxFeed: 10000,
      framingFeedMmPerMin: 8000,
    });
    expect(result.corrections.map((item) => item.field)).toEqual([
      'controllerKind',
      'streamingMode',
      'gcodeDialect',
    ]);
  });

  it('does not overwrite selected profile transport choices without a controller read', () => {
    const selected: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'grbl-v1.1',
      streamingMode: 'ping-pong',
      rxBufferBytes: 64,
    };

    const result = profileWithControllerFactsResult({
      profile: selected,
      current: DEFAULT_DEVICE_PROFILE,
      detectedSettings: null,
      controllerSettings: null,
      detectedControllerKind: null,
      lastSettingsReadAt: null,
    });

    expect(result.profile.streamingMode).toBe('ping-pong');
    expect(result.profile.rxBufferBytes).toBe(64);
    expect(result.corrections).toEqual([]);
  });

  it('does not copy laser-only controller facts into a CNC device profile', () => {
    const selected: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      maxPowerS: 1000,
      minPowerS: 0,
      laserModeEnabled: false,
    };
    const cncFacts = {
      profile: selected,
      current: {
        ...DEFAULT_DEVICE_PROFILE,
        maxPowerS: 12000,
        minPowerS: 40,
        laserModeEnabled: true,
      },
      detectedSettings: {
        maxPowerS: 24000,
        minPowerS: 80,
        laserModeEnabled: true,
      },
      controllerSettings: {
        maxPowerS: 18000,
        minPowerS: 60,
        laserModeEnabled: true,
      },
      detectedControllerKind: 'grblhal' as const,
      lastSettingsReadAt: 1,
      machineKind: 'cnc' as const,
    };

    const result = profileWithControllerFactsResult(cncFacts);

    expect(result.profile.maxPowerS).toBe(selected.maxPowerS);
    expect(result.profile.minPowerS).toBe(selected.minPowerS);
    expect(result.profile.laserModeEnabled).toBe(selected.laserModeEnabled);
  });
});

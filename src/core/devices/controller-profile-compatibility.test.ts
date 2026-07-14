import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';
import {
  controllerCompatibleProfile,
  controllerProfilesAreCompatible,
} from './controller-profile-compatibility';

describe('controllerCompatibleProfile', () => {
  it('leaves a coherent legacy GRBL profile byte-for-byte unchanged', () => {
    const result = controllerCompatibleProfile(DEFAULT_DEVICE_PROFILE);

    expect(result.profile).toEqual(DEFAULT_DEVICE_PROFILE);
    expect(result.corrections).toEqual([]);
  });

  it('normalizes a detected Marlin controller to one-line streaming and Marlin output', () => {
    const result = controllerCompatibleProfile(DEFAULT_DEVICE_PROFILE, 'marlin');

    expect(result.profile).toMatchObject({
      controllerKind: 'marlin',
      streamingMode: 'ping-pong',
      gcodeDialect: { dialectId: 'marlin-inline' },
    });
    expect(result.corrections.map((item) => item.field)).toEqual([
      'controllerKind',
      'streamingMode',
      'gcodeDialect',
    ]);
  });

  it('preserves an explicitly selected Marlin fan dialect', () => {
    const profile: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      streamingMode: 'ping-pong',
      gcodeDialect: { dialectId: 'marlin-fan' },
    };

    const result = controllerCompatibleProfile(profile);

    expect(result.profile.gcodeDialect.dialectId).toBe('marlin-fan');
    expect(result.corrections).toEqual([]);
  });

  it('restores fast char-counted streaming when detection crosses from Marlin to GRBL', () => {
    const profile: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      streamingMode: 'ping-pong',
      gcodeDialect: { dialectId: 'marlin-inline' },
    };

    const result = controllerCompatibleProfile(profile, 'grblhal');

    expect(result.profile).toMatchObject({
      controllerKind: 'grblhal',
      streamingMode: 'char-counted',
      gcodeDialect: { dialectId: 'grbl-dynamic' },
    });
  });

  it('forces Smoothieware to one-line streaming and removes a Marlin dialect', () => {
    const profile: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      streamingMode: 'char-counted',
      gcodeDialect: { dialectId: 'marlin-inline' },
    };

    const result = controllerCompatibleProfile(profile, 'smoothieware');

    expect(result.profile).toMatchObject({
      controllerKind: 'smoothieware',
      streamingMode: 'ping-pong',
      gcodeDialect: { dialectId: 'grbl-dynamic' },
    });
  });

  it('normalizes an invalid receive window supplied by programmatic callers', () => {
    const profile = { ...DEFAULT_DEVICE_PROFILE, rxBufferBytes: 0 };

    const result = controllerCompatibleProfile(profile);

    expect(result.profile.rxBufferBytes).toBe(120);
    expect(result.corrections).toContainEqual(
      expect.objectContaining({ field: 'rxBufferBytes', from: '0', to: '120' }),
    );
  });
});

describe('controllerProfilesAreCompatible', () => {
  it('treats an absent legacy kind as GRBL v1.1', () => {
    expect(controllerProfilesAreCompatible(undefined, 'grbl-v1.1')).toBe(true);
    expect(controllerProfilesAreCompatible(undefined, 'grblhal')).toBe(false);
  });

  it('allows an unknown detected kind until a banner is available', () => {
    expect(controllerProfilesAreCompatible('marlin', null)).toBe(true);
  });
});

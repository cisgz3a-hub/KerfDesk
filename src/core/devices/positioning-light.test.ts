import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from './device-profile';
import { controllerCompatibleProfile } from './controller-profile-compatibility';
import { normalizePositioningLight, positioningLightIssue } from './positioning-light';

const light = { onCommand: 'M64 P0', offCommand: 'M65 P0', offsetXmm: 10, offsetYmm: -5 };

describe('separate positioning light configuration', () => {
  it.each([
    ['grbl-v1.1', 'M8', 'M9'],
    ['grblhal', 'M64 P0', 'M65 P0'],
    ['fluidnc', 'M64 P7', 'M65 P7'],
    ['marlin', 'M355 S1 P255', 'M355 S0'],
    ['smoothieware', 'M106.1', 'M107.1'],
  ] as const)(
    'accepts explicitly configured %s accessory commands',
    (kind, onCommand, offCommand) => {
      expect(positioningLightIssue({ ...light, onCommand, offCommand }, kind)).toBeNull();
    },
  );

  it.each([
    'M3 S1',
    'M04 S1',
    'M5',
    'M104 S200',
    'M109 S200',
    'M999',
    'M30',
    'M280 P0 S90',
    'M64 P0\nM3',
    'M64 P0 G0 X10',
    'M64 P0;M3',
    'M64 P0\x18',
    'M64 P0\t',
    'G0 X10',
    '$H',
    'switch pointer on;reset',
    'M64 P0 X5',
    'switch pointer on',
    'M355 S1'.repeat(20),
  ])('rejects non-accessory command %s', (onCommand) => {
    expect(positioningLightIssue({ ...light, onCommand })).not.toBeNull();
  });

  it.each([NaN, Infinity, -Infinity, 1001, -1001, '10', null])(
    'rejects invalid offset %s',
    (offsetXmm) => {
      expect(positioningLightIssue({ ...light, offsetXmm })).not.toBeNull();
    },
  );

  it('does not invent a light for existing machines or repair invalid commands silently', () => {
    expect(positioningLightIssue(undefined)).toBeNull();
    expect(normalizePositioningLight(undefined)).toBeUndefined();
    expect(normalizePositioningLight({ ...light, onCommand: 'M3' })).toBeUndefined();
    expect(positioningLightIssue({ ...light, offCommand: light.onCommand })).not.toBeNull();
    expect(normalizePositioningLight({ ...light, onCommand: ' M64 P0 ' })).toEqual(light);
  });

  it.each([
    ['fluidnc', 'M64 P8'],
    ['fluidnc', 'M64 P1.5'],
    ['grblhal', 'M64 P256'],
    ['grblhal', 'M64'],
    ['grblhal', 'M62 P0'],
    ['fluidnc', 'M63 P0'],
  ] as const)('rejects invalid %s digital output %s', (kind, onCommand) => {
    expect(positioningLightIssue({ ...light, onCommand }, kind)).not.toBeNull();
  });

  it('clears an accessory mapping when switching controller families and keeps it otherwise', () => {
    const profile = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'grblhal' as ControllerKind,
      positioningLight: light,
    };
    expect(controllerCompatibleProfile(profile, 'marlin').profile.positioningLight).toBeUndefined();
    expect(controllerCompatibleProfile(profile, 'grblhal').profile.positioningLight).toEqual(light);
  });
});

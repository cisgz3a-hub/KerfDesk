import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type ControllerKind } from './device-profile';
import { controllerCompatibleProfile } from './controller-profile-compatibility';
import {
  normalizePositioningLight,
  POSITIONING_LIGHT_UNSUPPORTED_MESSAGE,
  positioningLightIssue,
  positioningLightSupported,
} from './positioning-light';

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

describe('Centre & LED after Frame setting (ADR-605)', () => {
  it('accepts a boolean and keeps only an enabled setting when normalizing', () => {
    expect(positioningLightIssue({ ...light, afterFrame: true }, 'grblhal')).toBeNull();
    expect(positioningLightIssue({ ...light, afterFrame: false }, 'grblhal')).toBeNull();
    expect(normalizePositioningLight({ ...light, afterFrame: true })).toEqual({
      ...light,
      afterFrame: true,
    });
    expect(normalizePositioningLight({ ...light, afterFrame: false })).toEqual(light);
  });

  it('rejects a non-boolean setting from a saved file', () => {
    expect(positioningLightIssue({ ...light, afterFrame: 'yes' }, 'grblhal')).toMatch(
      /after Frame/,
    );
  });
});

describe('laser-firing fan commands', () => {
  // The LED feature does not exist on a Marlin fan-mosfet laser: every mapping is refused.
  it.each([
    ['M106 S255', 'M107'],
    ['M106 P1 S255', 'M107 P1'],
    ['M106 P2', 'M107 P2'],
    ['M355 S1 P255', 'M355 S0'],
    ['M64 P0', 'M65 P0'],
    ['M7', 'M9'],
  ])('refuses any light %s / %s on a Marlin fan-mosfet laser profile', (onCommand, offCommand) => {
    expect(positioningLightIssue({ ...light, onCommand, offCommand }, 'marlin', 'marlin-fan')).toBe(
      POSITIONING_LIGHT_UNSUPPORTED_MESSAGE,
    );
    expect(
      normalizePositioningLight({ ...light, onCommand, offCommand }, 'marlin', 'marlin-fan'),
    ).toBeUndefined();
  });

  it('marks only the Marlin fan-mosfet dialect as having no positioning light', () => {
    expect(positioningLightSupported('marlin-fan')).toBe(false);
    for (const dialect of [undefined, 'marlin-inline', 'grbl-compatible', 'grbl-dynamic'])
      expect(positioningLightSupported(dialect)).toBe(true);
    expect(
      positioningLightIssue(
        { ...light, onCommand: 'M355 S1', offCommand: 'M355 S0' },
        'marlin',
        'marlin-inline',
      ),
    ).toBeNull();
  });

  it('refuses fan 0 everywhere, where it can be the laser', () => {
    for (const [onCommand, offCommand] of [
      ['M106 S255', 'M107'],
      ['M106 P0 S255', 'M107 P0'],
    ])
      expect(
        positioningLightIssue({ ...light, onCommand, offCommand }, 'marlin', 'marlin-inline'),
      ).toMatch(/non-zero P fan index/);
  });

  it('keeps a separate non-zero fan on an inline Marlin profile and Smoothie switches', () => {
    expect(
      positioningLightIssue(
        { ...light, onCommand: 'M106 P1 S255', offCommand: 'M107 P1' },
        'marlin',
        'marlin-inline',
      ),
    ).toBeNull();
    expect(
      positioningLightIssue({ ...light, onCommand: 'M106', offCommand: 'M107' }, 'smoothieware'),
    ).toBeNull();
  });

  it('drops a fan-laser mapping when normalizing a Marlin fan-mosfet profile', () => {
    expect(
      normalizePositioningLight(
        { ...light, onCommand: 'M106 P1 S255', offCommand: 'M107 P1' },
        'marlin',
        'marlin-fan',
      ),
    ).toBeUndefined();
  });
});

describe('positioning light command meaning', () => {
  it.each([810, 811, 812, 813, 814, 815, 816, 817, 818, 819])(
    'rejects stored macro M%s as either Marlin light command, including padded aliases',
    (code) => {
      for (const command of [`M${code}`, `m0${code}.0`]) {
        for (const field of ['onCommand', 'offCommand'] as const) {
          const mapping = { ...light, [field]: command };
          for (const kind of ['marlin', undefined] as const) {
            expect(positioningLightIssue(mapping, kind)).toMatch(/stored macro/);
            expect(normalizePositioningLight(mapping, kind)).toBeUndefined();
          }
        }
      }
    },
  );

  it('keeps explicitly configured accessory codes on other controller families', () => {
    expect(
      positioningLightIssue({ ...light, onCommand: 'M810', offCommand: 'M811' }, 'smoothieware'),
    ).toBeNull();
  });

  it.each([
    ['M355 S1', 'M0355 S1'],
    ['M355 S1', 'm355  s1'],
    ['M355 S1', 'M355 S01.0'],
    ['M355 S1 P255', 'M0355 P0255.00 S+1'],
    ['M106.01 P02', 'M0106.1 P2.0'],
    // Fan 0 can be the laser, so the zero-subcode case uses an accessory code.
    ['M355 S0', 'M355.0 S-0'],
  ])('rejects equivalent on/off commands %s and %s', (onCommand, offCommand) => {
    expect(positioningLightIssue({ ...light, onCommand, offCommand }, 'marlin')).toContain(
      'different',
    );
  });

  it.each(['M355 S1 S1', 'M355 S0 S1', 'M710 P0 p1'])(
    'rejects ambiguous duplicate parameter words in %s',
    (offCommand) => {
      expect(
        positioningLightIssue({ ...light, onCommand: 'M355 S1', offCommand }, 'marlin'),
      ).not.toBeNull();
    },
  );

  it.each(['grblhal', 'fluidnc'] as const)(
    'rejects standard %s output pairs that cannot switch the same output off',
    (kind) => {
      for (const [onCommand, offCommand] of [
        ['M64 P0', 'M65 P1'],
        ['M64 P0', 'M64 P1'],
        ['M65 P0', 'M65 P1'],
      ]) {
        expect(positioningLightIssue({ ...light, onCommand, offCommand }, kind)).toContain(
          'same output',
        );
      }
    },
  );

  it.each(['grblhal', 'fluidnc'] as const)('retains normal and active-low %s pairs', (kind) => {
    for (const [onCommand, offCommand] of [
      ['M64 P0', 'M65 P0'],
      ['M065 P00', 'm064 p0'],
    ])
      expect(positioningLightIssue({ ...light, onCommand, offCommand }, kind)).toBeNull();
  });

  it('retains distinct integer subcodes and documented custom mappings', () => {
    expect(
      positioningLightIssue(
        { ...light, onCommand: 'M106.10', offCommand: 'M106.1' },
        'smoothieware',
      ),
    ).toBeNull();
    expect(
      positioningLightIssue({ ...light, onCommand: 'M710 P1', offCommand: 'M711 P0' }, 'grblhal'),
    ).toBeNull();
    expect(
      positioningLightIssue({ ...light, onCommand: 'M64 P0', offCommand: 'M710 P0' }, 'fluidnc'),
    ).toBeNull();
  });

  it.each([
    'M125',
    'M48 P10',
    'M290 S1',
    'M361',
    'M362',
    'M363',
    'M364',
    'M401',
    'M402',
    'M701',
    'M702',
    'M915',
  ])('rejects standard motion/probing command %s as either light command', (command) => {
    expect(
      positioningLightIssue({ ...light, onCommand: command, offCommand: 'M355 S0' }, 'marlin'),
    ).not.toBeNull();
    expect(
      positioningLightIssue({ ...light, onCommand: 'M355 S1', offCommand: command }, 'marlin'),
    ).not.toBeNull();
  });
});

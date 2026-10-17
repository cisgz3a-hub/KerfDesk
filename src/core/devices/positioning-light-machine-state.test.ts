import { describe, expect, it } from 'vitest';
import { normalizePositioningLight, positioningLightIssue } from './positioning-light';

const light = { onCommand: 'M64 P0', offCommand: 'M65 P0', offsetXmm: 0, offsetYmm: 0 };

describe('positioning light laser-fan and machine-state guard', () => {
  it.each(['M106', 'M106 S255', 'M106 P0 S255', 'M107', 'M107 P0', 'M0106 P-0 S1'])(
    'rejects fan-0 command %s, which is the laser on a fan-mosfet Marlin',
    (onCommand) => {
      for (const kind of [undefined, 'marlin', 'grbl-v1.1'] as const)
        expect(
          positioningLightIssue({ ...light, onCommand, offCommand: 'M107 P1' }, kind),
        ).toContain('fan');
    },
  );

  it('accepts an explicit non-zero fan except on the marlin-fan dialect', () => {
    const fanLight = { ...light, onCommand: 'M106 P1 S255', offCommand: 'M107 P1' };
    expect(positioningLightIssue(fanLight, 'marlin', 'marlin-inline')).toBeNull();
    expect(positioningLightIssue(fanLight, 'marlin', 'marlin-fan')).toContain('fan-mosfet');
    expect(normalizePositioningLight(fanLight, 'marlin', 'marlin-fan')).toBeUndefined();
  });

  it('keeps Smoothieware switch subcodes, which are not Marlin fans', () => {
    expect(
      positioningLightIssue(
        { ...light, onCommand: 'M106.1', offCommand: 'M107.1' },
        'smoothieware',
      ),
    ).toBeNull();
  });

  it.each([
    'M42 P4 S255',
    'M43 T1 S4',
    'M80',
    'M92 S80',
    'M120',
    'M121',
    'M201 S1000',
    'M203 S100',
    'M204 S500',
    'M205 S1',
    'M206 S5',
    'M211 S0',
    'M220 S200',
    'M221 S50',
    'M290 S1',
    'M428',
    'M575 P0 S9600',
    'M851 S1',
    'M906 S800',
  ])('rejects state-changing command %s on every controller', (onCommand) => {
    for (const kind of ['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'] as const)
      expect(positioningLightIssue({ ...light, onCommand }, kind)).toContain('cannot change');
  });

  it('keeps documented accessory codes available', () => {
    expect(positioningLightIssue({ ...light, onCommand: 'M7', offCommand: 'M9' })).toBeNull();
    expect(
      positioningLightIssue({ ...light, onCommand: 'M355 S1', offCommand: 'M355 S0' }, 'marlin'),
    ).toBeNull();
    expect(positioningLightIssue(light, 'grblhal')).toBeNull();
  });
});

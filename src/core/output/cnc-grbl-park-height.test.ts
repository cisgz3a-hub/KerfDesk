// ADR-491 (CNC gap audit CW-07): the bit lifts to the park height before the
// job-end park and the bit-change park, so it clears clamps on the way.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup } from '../job';
import { cncGrblStrategy } from './cnc-grbl-strategy';

const dev = DEFAULT_DEVICE_PROFILE;

function group(overrides: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'profile-on-path',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [
      {
        kind: 'contour',
        zMm: -1.5,
        polyline: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 30 },
          { x: 10, y: 10 },
        ],
        closed: true,
      },
    ],
    ...overrides,
  };
}

describe('CNC park height (ADR-491)', () => {
  it('lifts to the park height before the job-end park', () => {
    const gcode = cncGrblStrategy.emit({ groups: [group({ parkZMm: 25 })] }, dev);
    expect(gcode.endsWith('G0 Z25.000\nM5\nG0 X0.000 Y0.000\n')).toBe(true);
  });

  it('lifts to the park height before a bit-change park, then resumes at safe Z', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group({ toolId: 't1', parkZMm: 25 }),
          group({ toolId: 't2', layerId: 'L2', parkZMm: 25 }),
        ],
      },
      dev,
    );
    const beforeHold = gcode.slice(0, gcode.indexOf('M0'));
    expect(beforeHold).toContain('G0 Z25.000\nM5\nG0 X0.000 Y0.000');
    const afterHold = gcode.slice(gcode.indexOf('M0'));
    expect(afterHold).toContain('G0 Z3.810\nM3 S12000');
  });

  it('never parks below safe Z, and keeps safe Z without a park height', () => {
    expect(
      cncGrblStrategy
        .emit({ groups: [group({ parkZMm: 1 })] }, dev)
        .endsWith('G0 Z3.810\nM5\nG0 X0.000 Y0.000\n'),
    ).toBe(true);
    expect(
      cncGrblStrategy
        .emit({ groups: [group()] }, dev)
        .endsWith('G0 Z3.810\nM5\nG0 X0.000 Y0.000\n'),
    ).toBe(true);
  });
});

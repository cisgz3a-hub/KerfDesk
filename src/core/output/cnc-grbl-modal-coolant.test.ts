// Regression pins for two emission defects found by the 2026-07-25 CNC audit:
// the preamble never selected a working plane (1.5), and coolant kept running
// through the manual tool-change hold (1.13).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup } from '../job';
import { cncGrblStrategy } from './cnc-grbl-strategy';

const dev = DEFAULT_DEVICE_PROFILE;

function squareLoop(at: number, size: number): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x: at, y: at },
    { x: at + size, y: at },
    { x: at + size, y: at + size },
    { x: at, y: at + size },
    { x: at, y: at },
  ];
}

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
    passes: [{ kind: 'contour', zMm: -1.5, polyline: squareLoop(10, 20), closed: true }],
    ...overrides,
  };
}

describe('CNC preamble selects the XY plane (audit 1.5)', () => {
  it('emits G17 in the preamble', () => {
    const gcode = cncGrblStrategy.emit({ groups: [group()] }, dev);
    expect(gcode.split('\n').slice(0, 5)).toEqual(['G21', 'G90', 'G54', 'G94', 'G17']);
  });

  it('emits G17 before the first cutting move, so arcs can never be read in G18/G19', () => {
    const gcode = cncGrblStrategy.emit({ groups: [group()] }, dev);
    const lines = gcode.split('\n');
    const planeAt = lines.indexOf('G17');
    // G1/G2/G3 with a trailing space, so the 'G21' units word is not a match.
    const firstCutAt = lines.findIndex((line) => /^G[123] /.test(line));
    expect(planeAt).toBeGreaterThanOrEqual(0);
    expect(planeAt).toBeLessThan(firstCutAt);
  });
});

describe('coolant is closed across the tool-change hold (audit 1.13)', () => {
  const twoTools = {
    groups: [
      group({ layerId: 'L1', toolId: 't1', toolName: '1/8 flat', coolant: 'flood' as const }),
      group({ layerId: 'L2', toolId: 't2', toolName: '1/4 flat', coolant: 'flood' as const }),
    ],
  };

  it('turns coolant off before M0 and back on only after the spindle restarts', () => {
    const lines = cncGrblStrategy.emit(twoTools, dev).split('\n');
    const holdAt = lines.indexOf('M0');
    expect(holdAt).toBeGreaterThan(0);

    // Before the hold: the preamble M8, then the M9 that closes it.
    const stopAt = lines.lastIndexOf('M9', holdAt);
    expect(stopAt).toBeGreaterThan(0);
    expect(stopAt).toBeLessThan(holdAt);
    expect(lines[stopAt - 1]).toBe('M5');

    // After the hold: M3 comes back first, and only then the coolant reopens.
    const restartAt = lines.findIndex((line, index) => index > holdAt && line.startsWith('M3 '));
    const reopenAt = lines.findIndex((line, index) => index > holdAt && line === 'M8');
    expect(restartAt).toBeGreaterThan(holdAt);
    expect(reopenAt).toBeGreaterThan(restartAt);
  });

  it('a job without coolant emits no M7/M8/M9 at all', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group({ layerId: 'L1', toolId: 't1', toolName: '1/8 flat' }),
          group({ layerId: 'L2', toolId: 't2', toolName: '1/4 flat' }),
        ],
      },
      dev,
    );
    expect(gcode).not.toMatch(/^M[789]$/m);
  });
});

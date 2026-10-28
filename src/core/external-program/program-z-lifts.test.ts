// ADR-491 Amendment 3 (rolling audit v5 J7-P2-2): the Run review reads how
// high a program lifts Z, in the work coordinates it starts in and in machine
// coordinates for its G53 moves, so the live Z-top check can run on it.

import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel } from '../gcode-view';
import { reviewExternalProgram } from './external-program-review';
import { normalizeExternalProgram } from './normalize-external-program';

const HEAD = { x: 50, y: 50, z: 0 };

// As the Run dialog does: the exact canonical bytes, read from where the head stands.
function zLifts(file: string, start = HEAD) {
  const normalized = normalizeExternalProgram(file);
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
  const gcode = normalized.program.gcode;
  const result = buildGcodeRenderModel(gcode, {
    machineKind: 'cnc',
    initialPositionMm: start,
    boundsFromStart: true,
  });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return reviewExternalProgram(gcode, result.model, {
    machineKind: 'cnc',
    laserMaxPowerS: 1000,
    start,
  }).zLifts;
}

describe('external program Z lifts', () => {
  it('reads the highest work Z, the park lift at the end of a per-bit file', () => {
    expect(
      zLifts('G21 G90 G54\nG0 Z5\nG1 Z-1 F100\nG1 X60 F600\nG0 Z5\nG0 Z50\nM5\nG0 X0 Y0\n'),
    ).toEqual({ workMaxMm: 50, machineMaxMm: null });
  });

  it('counts where the head starts, which a program that only cuts never leaves upward', () => {
    expect(zLifts('G21 G90\nG1 Z-1 F100\nG1 X60 F600\n', { ...HEAD, z: 2 })).toEqual({
      workMaxMm: 2,
      machineMaxMm: null,
    });
  });

  it('reads a G53 move as a machine Z, outside the work outline', () => {
    expect(zLifts('G21 G90\nG53 G0 Z-2\nG0 Z5\nG53 G0 Z-1\nG53 G0 X0 Y0\n')).toEqual({
      workMaxMm: 5,
      machineMaxMm: -1,
    });
  });

  it('reads a G53 Z in the units in effect, even after a relative mode', () => {
    expect(zLifts('G20 G91\nG53 G0 Z0.1\n').machineMaxMm).toBeCloseTo(2.54, 6);
    expect(zLifts('G20\nG21\nG53 G0 Z3\n').machineMaxMm).toBe(3);
  });
});

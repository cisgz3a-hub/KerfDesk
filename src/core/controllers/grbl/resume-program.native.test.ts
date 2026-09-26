// Resume transform 3 for Smoothieware and Marlin laser programs (ADR-364): the
// preamble and replay are written in the power commands the program's own
// strategy writes, and transforms 1 and 2 still build GRBL's for every
// program, so their archived steps replay byte for byte.

import { describe, expect, it } from 'vitest';
import type { LaserResumeDialect } from './laser-resume-dialect';
import {
  buildResumeProgram,
  LASER_RESUME_TRANSFORM_VERSION,
  type LaserResumeTransformVersion,
} from './resume-program';

function resume(
  gcode: string,
  fromLine: number,
  laserDialect?: LaserResumeDialect,
  transform?: LaserResumeTransformVersion,
): ReadonlyArray<string> {
  const result = buildResumeProgram(gcode, fromLine, {
    machineKind: 'laser',
    safeZMm: 0,
    spindleSpinupSec: 0,
    plungeMmPerMin: 300,
    ...(laserDialect === undefined ? {} : { laserDialect }),
    ...(transform === undefined ? {} : { laserTransform: transform }),
  });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.lines;
}

// smoothieware-strategy.ts: GRBL's M4 S0 / M5 become M400 + M221, power is S.
const SMOOTHIE = [
  'fire off',
  'G21',
  'G90',
  'G54',
  'G94',
  'M400',
  'M221 S100 P0',
  'M8',
  'G0 X0 Y0 S0',
  'G1 X10 Y0 F1500 S0.300',
  'G1 X20 Y0', // restart line 11: modal power
  'M400',
  'M221 S0',
  'M9',
].join('\n');

// marlin-inline-transform.ts: M3 I S0 arms, M5 I disarms, power is G1's S.
const MARLIN_INLINE = [
  'M5 I',
  'G21',
  'G90',
  'M3 I S0',
  'M8',
  'G0 X0 Y0 S0',
  'G1 X10 Y0 F1500 S76',
  'G1 X20 Y0', // restart line 8: modal power
  'M5 I',
  'M9',
].join('\n');

// marlin-fan-transform.ts: M106 sets the beam, M107 turns it off.
const MARLIN_FAN = [
  'G21',
  'G90',
  'M107',
  'M8',
  'G0 X0 Y0',
  'M106 S76',
  'G1 X10 Y0 F1500',
  'G1 X20 Y0', // restart line 8: the fan is still at 76
  'M107', // restart line 9: the program turns the fan off first
  'M9',
].join('\n');

const GRBL = 'G21\nG90\nM8\nM4 S0\nG0 X0 Y0 S0\nG1 X10 Y0 F1500 S300\nX20 S200\nM5\nM9';

describe('laser resume transform 3', () => {
  it('leaves GRBL-family programs without arcs or a plane word as transform 2 did', () => {
    // Transform 4 (ADR-432) only adds the plane pin, which this program lacks.
    expect(LASER_RESUME_TRANSFORM_VERSION).toBe(4);
    for (const fromLine of [5, 6, 7, 8]) {
      expect(resume(GRBL, fromLine)).toEqual(resume(GRBL, fromLine, undefined, 2));
      expect(resume(GRBL, fromLine, 'grbl')).toEqual(resume(GRBL, fromLine, undefined, 2));
    }
  });

  it('re-arms Smoothieware with M221 and restores the modal S the burn uses', () => {
    expect(resume(SMOOTHIE, 11, 'smoothieware')).toEqual([
      '; KerfDesk resume preamble',
      'fire off',
      'G21',
      'G90',
      'G54',
      'G94',
      'M400',
      'M221 S0',
      'M8',
      'G0 X10 Y0 S0',
      'M400',
      'M221 S100 P0',
      'F1500',
      'G1 X20 Y0 S0.300',
      'M400',
      'M221 S0',
      'M9',
    ]);
  });

  it('never reads an M221 percent as power', () => {
    const program = SMOOTHIE.replace('G1 X20 Y0', 'M400\nM221 S100 P1\nG1 X20 Y0');
    const lines = resume(program, 13, 'smoothieware');
    expect(lines).toContain('M221 S100 P1');
    expect(lines.at(-4)).toBe('G1 X20 Y0 S0.300');
  });

  it('re-arms Marlin inline power with M3 I and sets the feed on a G1', () => {
    expect(resume(MARLIN_INLINE, 8, 'marlin-inline')).toEqual([
      '; KerfDesk resume preamble',
      'G21',
      'G90',
      'M5 I',
      'M8',
      'G0 X10 Y0 S0',
      'M3 I S0',
      'G1 F1500',
      'G1 X20 Y0 S76',
      'M5 I',
      'M9',
    ]);
  });

  it('keeps a Marlin move dark after a G0, as the firmware does', () => {
    // gcode.cpp: G0 sets the inline power to 0; a later G1 without S burns at 0.
    const program = MARLIN_INLINE.replace('G1 X20 Y0', 'G0 X15 Y0 S0\nG1 X20 Y0');
    expect(resume(program, 9, 'marlin-inline').slice(-3)).toEqual(['G1 X20 Y0', 'M5 I', 'M9']);
  });

  it('turns a Marlin fan beam off before the re-entry and back on just before the move', () => {
    expect(resume(MARLIN_FAN, 8, 'marlin-fan')).toEqual([
      '; KerfDesk resume preamble',
      'G21',
      'G90',
      'M107',
      'M8',
      'G0 X10 Y0',
      'G1 F1500',
      'M106 S76',
      'G1 X20 Y0',
      'M107',
      'M9',
    ]);
  });

  it('restores no fan power when the program turns the fan off before moving', () => {
    const lines = resume(MARLIN_FAN, 9, 'marlin-fan');
    expect(lines.some((line) => line.startsWith('M106'))).toBe(false);
  });

  it('restores fan power after the lines that do not move, right before the move', () => {
    const program = MARLIN_FAN.replace('G1 X20 Y0', '; row 2\nM8\nG1 X20 Y0');
    const lines = resume(program, 8, 'marlin-fan');
    expect(lines.slice(-6)).toEqual(['; row 2', 'M8', 'M106 S76', 'G1 X20 Y0', 'M107', 'M9']);
  });
});

describe('laser resume transforms 1 and 2 on Smoothieware and Marlin programs', () => {
  it.each([
    ['smoothieware', SMOOTHIE, 11],
    ['marlin-inline', MARLIN_INLINE, 8],
    ['marlin-fan', MARLIN_FAN, 8],
  ] as const)('%s: build the GRBL bytes their archived steps hold', (dialect, program, line) => {
    for (const transform of [1, 2] as const) {
      expect(resume(program, line, dialect, transform)).toEqual(
        resume(program, line, undefined, transform),
      );
    }
    expect(resume(program, line, dialect, 2)).not.toEqual(resume(program, line, dialect, 3));
  });
});

// Laser resume transforms (ADR-341 Amendment 3). Transform 2 re-issues air
// assist and names the program's motion mode on the first resumed line that
// relies on it; transform 1 is kept byte-for-byte so saved recoveries replay.

import { describe, expect, it } from 'vitest';
import {
  buildResumeProgram,
  LASER_RESUME_TRANSFORM_VERSION,
  type LaserResumeTransformVersion,
  type ResumeOptions,
} from './resume-program';

const RASTER_WITH_AIR = [
  'G21',
  'G90',
  'M8',
  'M4 S0',
  'G0 X0 Y0 S0',
  'G1 X10 Y0 F1500 S300',
  'X20 S200',
  'X30 S100',
  'M5',
  'M9',
].join('\n');

function resume(gcode: string, fromLine: number, transform?: LaserResumeTransformVersion) {
  const options: ResumeOptions = {
    machineKind: 'laser',
    safeZMm: 0,
    spindleSpinupSec: 0,
    plungeMmPerMin: 300,
    ...(transform === undefined ? {} : { laserTransform: transform }),
  };
  const result = buildResumeProgram(gcode, fromLine, options);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result;
}

describe('laser resume transform 2 (current)', () => {
  it('is the transform new resumes use', () => {
    expect(LASER_RESUME_TRANSFORM_VERSION).toBe(2);
    expect(resume(RASTER_WITH_AIR, 7).lines).toEqual(resume(RASTER_WITH_AIR, 7, 2).lines);
  });

  it('re-issues air assist before the re-entry and names G1 on the first continuation line', () => {
    expect(resume(RASTER_WITH_AIR, 7, 2).lines).toEqual([
      '; KerfDesk resume preamble',
      'G21',
      'G90',
      'G54',
      'G94',
      'M5',
      'M8',
      'G0 X10 Y0 S0',
      'M4 S0',
      'F1500',
      'G1 X20 S200',
      'X30 S100',
      'M5',
      'M9',
    ]);
  });

  it('re-issues both air outputs, and none after M9', () => {
    const both = RASTER_WITH_AIR.replace('M8', 'M7\nM8');
    expect(resume(both, 8, 2).lines.slice(5, 8)).toEqual(['M5', 'M7', 'M8']);
    const cleared = RASTER_WITH_AIR.replace('M4 S0', 'M9\nM4 S0');
    const lines = resume(cleared, 8, 2).lines;
    // Only the program's own closing M9 remains: the preamble re-issues nothing.
    expect(lines.filter((line) => /^M[789]$/.test(line))).toEqual(['M9']);
  });

  it('writes the motion word in the line style of the program', () => {
    const compact = 'G21\nG90\nM4S0\nG0X0Y0S0\nG1X10Y0F1500S300\nX20S200\n  X30S100 ; row end\nM5';
    expect(resume(compact, 6, 2).lines.slice(-3)).toEqual([
      'G1X20S200',
      '  X30S100 ; row end',
      'M5',
    ]);
    expect(resume(compact, 7, 2).lines.slice(-2)).toEqual(['  G1X30S100 ; row end', 'M5']);
  });

  it('keeps a leading line number first', () => {
    const numbered =
      'G21\nG90\nM4 S0\nG0 X0 Y0 S0\nG1 X10 Y0 F900 S300\nN6 X20 S200\nN7X30S100\nM5';
    expect(resume(numbered, 6, 2).lines.slice(-3)).toEqual(['N6 G1 X20 S200', 'N7X30S100', 'M5']);
    expect(resume(numbered, 7, 2).lines.slice(-2)).toEqual(['N7G1X30S100', 'M5']);
  });

  it('leaves a tail alone when its first movement names its own motion', () => {
    const vector = 'G21\nG90\nM3 S0\nG0 X0 Y0 S0\nG1 X10 Y0 F900 S500\nG1 X10 Y10\nM5';
    expect(resume(vector, 6, 2).lines.slice(-2)).toEqual(['G1 X10 Y10 S500', 'M5']);
  });

  it('skips lines that consume their own axis words before naming the motion', () => {
    const program = 'G21\nG90\nM4 S0\nG0 X0 Y0 S0\nG1 X1 Y0 F900 S200\nG92 X0\nX5 S200\nM5';
    expect(resume(program, 6, 2).lines.slice(-3)).toEqual(['G92 X0', 'G1 X5 S200', 'M5']);
  });

  it('follows the controller when a modal G word shares a line with axis words', () => {
    // GRBL runs the modal motion for any axis words without an axis command:
    // G90 on the line does not stop X20 burning. Transform 1 treated the line as
    // dark and zeroed its power.
    const program = 'G21\nG90\nM4 S0\nG0 X0 Y0 S0\nG1 X10 Y0 F900 S300\nG90 X20 S200\nM5';
    expect(resume(program, 6, 2).lines.slice(-2)).toEqual(['G1 G90 X20 S200', 'M5']);
    expect(resume(program, 6, 1).lines.slice(-2)).toEqual(['G90 X20 S0', 'M5']);
  });

  it('names no motion, and keeps the beam off, when the program never named one', () => {
    // Unknown motion is never treated as a burn, in either transform.
    const program = 'G21\nG90\nM4 S0\nX5 Y5 F1000 S0\nX10 S200\nM5';
    expect(resume(program, 5, 2).lines.slice(-2)).toEqual(['X10 S0', 'M5']);
    expect(resume(program, 5, 1).lines.slice(-2)).toEqual(['X10 S0', 'M5']);
  });
});

describe('laser resume transform 1 (replayed for saved recoveries)', () => {
  it('reproduces the original bytes: no air words and the continuation line unchanged', () => {
    expect(resume(RASTER_WITH_AIR, 7, 1).lines).toEqual([
      '; KerfDesk resume preamble',
      'G21',
      'G90',
      'G54',
      'G94',
      'M5',
      'G0 X10 Y0 S0',
      'M4 S0',
      'F1500',
      'X20 S200',
      'X30 S100',
      'M5',
      'M9',
    ]);
  });

  it('keeps the same line count for the tail in both transforms', () => {
    for (const fromLine of [6, 7, 8, 9, 10]) {
      const one = resume(RASTER_WITH_AIR, fromLine, 1);
      const two = resume(RASTER_WITH_AIR, fromLine, 2);
      expect(one.lines.length - one.preambleCount).toBe(two.lines.length - two.preambleCount);
    }
  });
});

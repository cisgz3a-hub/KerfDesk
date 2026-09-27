// How far the program travels between two lines (ADR-341 Amendment 7): the
// stretch after the last line a controller confirmed before a lost link.

import { describe, expect, it } from 'vitest';
import { resumeTravelMm } from './resume-program';

const PROGRAM = [
  'G21 G90 G54',
  'M4 S0',
  'G0 X10 Y20',
  'G1 X15.5 S300 F3000',
  '; a comment moves nothing',
  'Y22.25',
  'G1 X5 Y22.25',
  'M5',
].join('\n');

describe('resumeTravelMm', () => {
  it('sums the XY moves between the two lines', () => {
    // From the head at X10 Y20 (before line 4) to X5 Y22.25 (before line 8).
    expect(resumeTravelMm(PROGRAM, 4, 8)).toBeCloseTo(5.5 + 2.25 + 10.5, 9);
    expect(resumeTravelMm(PROGRAM, 4, 4)).toBe(0);
  });

  it('counts inches in millimetres', () => {
    const program = ['G20 G90 G54', 'G0 X1 Y1', 'G1 X2 S100 F20', 'M5'].join('\n');
    expect(resumeTravelMm(program, 3, 4)).toBeCloseTo(25.4, 9);
  });

  it('counts nothing until the program has both X and Y', () => {
    const program = ['G21 G90', 'G0 X5', 'G0 Y5', 'G1 X10 S100 F1000'].join('\n');
    expect(resumeTravelMm(program, 1, 5)).toBe(5);
  });

  it('declines spans it cannot follow', () => {
    expect(resumeTravelMm(PROGRAM, 5, 4)).toBeNull();
    expect(resumeTravelMm(PROGRAM, 0, 4)).toBeNull();
    expect(resumeTravelMm(PROGRAM, 1, 100)).toBeNull();
    const relative = ['G21 G91', 'G0 X5 Y5', 'G1 X10 S100 F1000'].join('\n');
    expect(resumeTravelMm(relative, 1, 4)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { hasCuttingMove } from './cutting-move';

// Audit follow-up to #1403: the per-bit tile split dropped any run without a
// literal `G1`, so a pass that opened with an arc would lose its whole file.
describe('hasCuttingMove', () => {
  it('counts a feed line or an arc, in any spelling of the word', () => {
    for (const gcode of [
      'G1 X10 F600',
      'G01 X10',
      'G2 X10 Y0 I5 J0',
      'G03X0Y0R5',
      'G0 Z5\nG1 Z-1',
      'X1G1X2',
    ]) {
      expect(hasCuttingMove(gcode)).toBe(true);
    }
  });

  it('does not count rapids, other G words or a bare program', () => {
    for (const gcode of [
      'G0 X10',
      'G21\nG90\nM5',
      'G10 L20 P1 X0',
      'G28',
      'G17 G20',
      'G38.2 Z-5 F100',
      'G1.5',
    ]) {
      expect(hasCuttingMove(gcode)).toBe(false);
    }
  });
});

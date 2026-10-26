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

  it.each(['G1.0 X10 F600', 'G01.000X10F600', 'G2.0 X10 Y0 I5 J0', 'G03.00X0Y0R5', 'G1. X10'])(
    'counts a motion word with a zero-only fractional part: %s',
    (gcode) => {
      expect(hasCuttingMove(gcode)).toBe(true);
    },
  );

  it.each([
    '; tool: G2 (load before starting)\nG21\nG90\nG0 Z3.810\nM5',
    '(G3 X10)\nG21\nG90\nM5',
    'G0 X10 ; G1 X20',
    'G0 X10 (G2 X20)',
  ])('ignores motion words inside comments: %s', (gcode) => {
    expect(hasCuttingMove(gcode)).toBe(false);
  });

  it('still finds a feed after a comment on an earlier line', () => {
    expect(hasCuttingMove('; G2 names a tool\nG1 X10 F600')).toBe(true);
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
      'G1.01',
      'G2.01',
      'G03.10',
      'G1..0',
    ]) {
      expect(hasCuttingMove(gcode)).toBe(false);
    }
  });
});

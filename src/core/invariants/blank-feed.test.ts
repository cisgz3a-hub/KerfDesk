import { describe, expect, it } from 'vitest';
import { findLongBlankFeedMoves } from './blank-feed';

describe('findLongBlankFeedMoves', () => {
  it('flags a long explicit G1 S0 move between known positions', () => {
    const gcode = ['G1 X0.000 Y0.000 F1500 S300', 'G1 X20.000 Y0.000 S0'].join('\n');

    const issues = findLongBlankFeedMoves(gcode, { thresholdMm: 5 });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.lineNumber).toBe(2);
    expect(issues[0]?.distanceMm).toBeCloseTo(20, 3);
  });

  it('uses sticky S0 when the G1 line omits S', () => {
    const gcode = ['G1 X0.000 Y0.000 S0', 'G1 X0.000 Y8.000'].join('\n');

    expect(findLongBlankFeedMoves(gcode, { thresholdMm: 5 })).toHaveLength(1);
  });

  it('does not flag short blank feed gaps at or below the threshold', () => {
    const gcode = ['G1 X0.000 Y0.000 S0', 'G1 X5.000 Y0.000 S0'].join('\n');

    expect(findLongBlankFeedMoves(gcode, { thresholdMm: 5 })).toEqual([]);
  });

  it('does not flag powered G1 moves', () => {
    const gcode = ['G1 X0.000 Y0.000 S300', 'G1 X20.000 Y0.000 S300'].join('\n');

    expect(findLongBlankFeedMoves(gcode, { thresholdMm: 5 })).toEqual([]);
  });

  it('does not flag G0 rapid moves because laser-on-travel owns that invariant', () => {
    const gcode = ['G1 X0.000 Y0.000 S0', 'G0 X20.000 Y0.000 S0'].join('\n');

    expect(findLongBlankFeedMoves(gcode, { thresholdMm: 5 })).toEqual([]);
  });

  it('measures distance from where a G0 left the head (modal position)', () => {
    // A G0 moves the head with the laser off; the next G1 S0's blank distance is
    // measured from the G0's endpoint, not the prior burn.
    const gcode = [
      'G1 X0.000 Y0.000 S300',
      'G0 X50.000 Y0.000 S0',
      'G1 X58.000 Y0.000 S0',
    ].join('\n');

    const issues = findLongBlankFeedMoves(gcode, { thresholdMm: 5 });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.lineNumber).toBe(3);
    expect(issues[0]?.distanceMm).toBeCloseTo(8, 3);
  });
});

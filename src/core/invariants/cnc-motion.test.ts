import { describe, expect, it } from 'vitest';
import { findPlungedTravelIssues } from './cnc-motion';

const SAFE = { safeZMm: 3.81 };

describe('findPlungedTravelIssues', () => {
  it('accepts retract-before-travel motion', () => {
    const gcode = [
      'G21',
      'G0 Z3.810',
      'G0 X10.000 Y10.000',
      'G1 Z-1.500 F300',
      'G1 X30.000 Y10.000 F1000',
      'G0 Z3.810',
      'G0 X0.000 Y0.000',
      'M5',
    ].join('\n');
    expect(findPlungedTravelIssues(gcode, SAFE)).toHaveLength(0);
  });

  it('flags an XY rapid while the bit is plunged', () => {
    const gcode = ['G0 Z3.810', 'G0 X1 Y1', 'G1 Z-2.000 F300', 'G0 X50.000 Y50.000'].join('\n');
    const issues = findPlungedTravelIssues(gcode, SAFE);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.lineNumber).toBe(4);
  });

  it('flags an XY rapid before any Z retract is established', () => {
    const issues = findPlungedTravelIssues('G0 X5.000 Y5.000', SAFE);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toMatch(/before any Z retract/);
  });

  it('flags a rapid plunge below the safe height', () => {
    const issues = findPlungedTravelIssues('G0 Z-1.000', SAFE);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toMatch(/below safe height/);
  });

  it('allows feed-rate plunges and comment lines', () => {
    const gcode = ['; header', 'G0 Z3.810', 'G1 Z-3.000 F250 ; plunge', 'G1 X4 Y4 F800'].join('\n');
    expect(findPlungedTravelIssues(gcode, SAFE)).toHaveLength(0);
  });
});

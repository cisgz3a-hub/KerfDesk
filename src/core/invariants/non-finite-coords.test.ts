import { describe, expect, it } from 'vitest';
import { findNonFiniteCoords } from './non-finite-coords';

describe('findNonFiniteCoords', () => {
  it('flags a NaN axis word on a motion line', () => {
    const issues = findNonFiniteCoords('G1 X10 YNaN F100 S50');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toContain('Y');
  });

  it('flags Infinity and -Infinity — the exact toFixed outputs for a non-finite number', () => {
    expect(findNonFiniteCoords('G0 X-Infinity Y1')).toHaveLength(1);
    expect(findNonFiniteCoords('G2 X5 Y5 I-Infinity J0')).toHaveLength(1);
  });

  it('passes a well-formed motion line', () => {
    expect(findNonFiniteCoords('G1 X10 Y5 F100 S50')).toEqual([]);
  });

  it('only scans motion commands (G0-G3)', () => {
    expect(findNonFiniteCoords('M3 S0')).toEqual([]);
  });

  it('reports the 1-based line number', () => {
    const issues = findNonFiniteCoords('G21\nG1 X1 Y1\nG1 XNaN Y2');
    expect(issues[0]?.lineNumber).toBe(3);
  });

  it('flags every bad coordinate on a line', () => {
    expect(findNonFiniteCoords('G1 XNaN YNaN')).toHaveLength(2);
  });

  it('does not trip on a coordinate that merely starts with a valid number', () => {
    // "Infinity"-like false positives must not fire on real values
    expect(findNonFiniteCoords('G1 X1.5 Y-2.25 Z0')).toEqual([]);
  });
});

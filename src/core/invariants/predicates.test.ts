import { describe, expect, it } from 'vitest';
import {
  collectG1FValues,
  collectG1SValues,
  expectedS,
  findLaserOnTravelIssues,
  findOutOfBoundsCoords,
} from './predicates';

describe('findLaserOnTravelIssues', () => {
  it('accepts G0 with S0 inline', () => {
    expect(findLaserOnTravelIssues('G0 X10 Y20 S0')).toEqual([]);
  });

  it('accepts lowercase travel commands and signed S0 words', () => {
    expect(findLaserOnTravelIssues('g0 x10 y20 s+0')).toEqual([]);
  });

  it('accepts G0 when the previous line is M5', () => {
    expect(findLaserOnTravelIssues('M5\nG0 X10 Y20')).toEqual([]);
  });

  it('accepts G0 when sticky S is already 0', () => {
    expect(findLaserOnTravelIssues('G1 X0 Y0 S0\nG0 X10 Y20')).toEqual([]);
  });

  it('flags a G0 with no S0 and no preceding M5/sticky-S0', () => {
    const issues = findLaserOnTravelIssues('G1 X0 Y0 S500\nG0 X10 Y20');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toContain('G0');
  });

  it('skips comment-only lines when judging previous effective command', () => {
    expect(findLaserOnTravelIssues('M5\n; comment line\nG0 X10 Y20')).toEqual([]);
  });
});

describe('findOutOfBoundsCoords', () => {
  const bed = { width: 400, height: 400 };

  it('accepts coords inside the bed', () => {
    expect(findOutOfBoundsCoords('G1 X0 Y0\nG1 X400 Y400', bed)).toEqual([]);
  });

  it('flags X > width', () => {
    const issues = findOutOfBoundsCoords('G1 X401 Y50', bed);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toMatch(/X out of bed/);
  });

  it('parses signed, leading-dot, trailing-dot, exponent, and lowercase motion words', () => {
    const issues = findOutOfBoundsCoords('g1 x+4.01e2 y.5\nG1 X1. Y-5e-1', bed);
    expect(issues.map((issue) => issue.reason)).toEqual([
      'X out of bed: 401',
      'Y out of bed: -0.5',
    ]);
  });

  it('flags Y < 0', () => {
    const issues = findOutOfBoundsCoords('G1 X10 Y-5', bed);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toMatch(/Y out of bed/);
  });

  it('ignores non-motion lines', () => {
    expect(findOutOfBoundsCoords('M5\nG21\nG90', bed)).toEqual([]);
  });
});

describe('expectedS', () => {
  it('rounds 50% × 1000 to 500', () => {
    expect(expectedS(50, 1000)).toBe(500);
  });

  it('rounds 50% × 255 to 128 (half-even rounding)', () => {
    // 50% × 255 = 127.5; Math.round rounds half away from zero → 128
    expect(expectedS(50, 255)).toBe(128);
  });

  it('rounds 50% × 100 to 50', () => {
    expect(expectedS(50, 100)).toBe(50);
  });
});

describe('collectG1SValues', () => {
  it('picks up S values on G1 lines only', () => {
    const gcode = ['G0 X0 Y0 S0', 'G1 X10 Y10 F1500 S500', 'G1 X20 Y20', 'M5'].join('\n');
    expect(collectG1SValues(gcode)).toEqual([500]);
  });

  it('collects lowercase and exponent S values on G1 lines', () => {
    expect(collectG1SValues('g1 x0 y0 s2.5e2\nG1 X1 Y1 S1.')).toEqual([250, 1]);
  });
});

describe('collectG1FValues', () => {
  it('picks up F values on G1 lines only', () => {
    const gcode = ['G0 X0 Y0 S0', 'G1 X10 Y10 F1500 S500', 'G1 X20 Y20 S500', 'M5'].join('\n');
    expect(collectG1FValues(gcode)).toEqual([1500]);
  });

  it('ignores comment lines carrying feed-like text', () => {
    expect(collectG1FValues('G0 X0 Y0 S0\n; feed 2500 mm/min\nG1 X1 Y1 F1200 S0')).toEqual([1200]);
  });
});

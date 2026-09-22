import { describe, expect, it } from 'vitest';
import { formatRulerLabel, rulerSteps } from './ruler-steps';

describe('ruler steps follow the zoom', () => {
  it.each([
    // [px per mm, expected labelled step in mm]
    [0.05, 2000],
    [0.2, 500],
    [0.6, 200],
    [1.5, 50],
    [4, 20],
    [12, 10],
    [40, 2],
    [140, 0.5],
    [700, 0.1],
  ])('labels every %i px/mm at a readable interval', (scale, labelMm) => {
    const steps = rulerSteps(scale);
    expect(steps.labelMm).toBe(labelMm);
    // The contract that makes the strip readable: labels never crowd, and
    // minor ticks never collapse into a bar.
    expect(steps.labelMm * scale).toBeGreaterThanOrEqual(62);
    expect(steps.minorMm * scale).toBeGreaterThanOrEqual(5);
  });

  it('nests minor ticks inside the labelled step so ticks and labels align', () => {
    for (const scale of [0.3, 1, 2.5, 7, 33, 210]) {
      const steps = rulerSteps(scale);
      expect(Number.isInteger(steps.subdivisions)).toBe(true);
      expect(steps.subdivisions).toBeGreaterThanOrEqual(1);
      expect(steps.minorMm * steps.subdivisions).toBeCloseTo(steps.labelMm, 10);
    }
  });

  it('survives a degenerate scale instead of dividing by it', () => {
    for (const scale of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const steps = rulerSteps(scale);
      expect(steps.labelMm).toBeGreaterThan(0);
      expect(steps.minorMm).toBeGreaterThan(0);
    }
  });

  it.each([
    [0, '0'],
    [-50, '-50'],
    [0.5, '0.5'],
    [0.25, '0.25'],
    [1000, '1000'],
    [-0.1, '-0.1'],
  ])('formats %s as %s', (mm, text) => {
    expect(formatRulerLabel(mm)).toBe(text);
  });
});

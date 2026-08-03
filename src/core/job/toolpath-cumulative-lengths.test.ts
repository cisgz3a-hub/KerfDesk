import { describe, expect, it } from 'vitest';

import { stepIndexAtLength, toolpathCumulativeLengths } from './toolpath-cumulative-lengths';
import type { ToolpathStep } from './toolpath-types';

function travelStep(length: number): ToolpathStep {
  return { kind: 'travel', from: { x: 0, y: 0 }, to: { x: length, y: 0 }, length };
}

describe('toolpathCumulativeLengths', () => {
  it('accumulates the arc length at the end of each step', () => {
    const steps = [travelStep(2), travelStep(3), travelStep(5)];

    expect(Array.from(toolpathCumulativeLengths(steps))).toEqual([2, 5, 10]);
  });

  it('reuses the prefix sums for the same steps array', () => {
    const steps = [travelStep(2), travelStep(3)];

    expect(toolpathCumulativeLengths(steps)).toBe(toolpathCumulativeLengths(steps));
  });

  it('recomputes for a rebuilt steps array carrying the same values', () => {
    const first = toolpathCumulativeLengths([travelStep(2), travelStep(3)]);
    const second = toolpathCumulativeLengths([travelStep(2), travelStep(3)]);

    expect(second).not.toBe(first);
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('is empty for a route with no steps', () => {
    expect(Array.from(toolpathCumulativeLengths([]))).toEqual([]);
  });
});

describe('stepIndexAtLength', () => {
  const cumulative = Float64Array.from([2, 5, 10]);

  it('selects the step a mid-route length falls inside', () => {
    expect(stepIndexAtLength(cumulative, 0)).toBe(0);
    expect(stepIndexAtLength(cumulative, 1)).toBe(0);
    expect(stepIndexAtLength(cumulative, 3)).toBe(1);
    expect(stepIndexAtLength(cumulative, 9.5)).toBe(2);
  });

  it('advances past a step whose end the length lands exactly on', () => {
    expect(stepIndexAtLength(cumulative, 2)).toBe(1);
    expect(stepIndexAtLength(cumulative, 5)).toBe(2);
  });

  it('reports one past the end when the length reaches the route end', () => {
    expect(stepIndexAtLength(cumulative, 10)).toBe(3);
    expect(stepIndexAtLength(cumulative, 11)).toBe(3);
  });

  it('reports one past the end of an empty route', () => {
    expect(stepIndexAtLength(Float64Array.from([]), 0)).toBe(0);
  });

  it('skips zero-length steps that share a boundary', () => {
    expect(stepIndexAtLength(Float64Array.from([10, 10, 20]), 10)).toBe(2);
  });
});

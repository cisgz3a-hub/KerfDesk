import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { vcarveTipReachability } from './vcarve-tip-reachability';

function band(widthMm: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: widthMm },
      { x: 0, y: widthMm },
    ],
  };
}

describe('vcarveTipReachability', () => {
  it.each([
    ['below', 0.3],
    ['at', 0.4],
  ] as const)('reports a feature %s the 0.4 mm tip diameter', (_label, widthMm) => {
    expect(vcarveTipReachability([band(widthMm)], 0.2)).toEqual({
      residualThin: true,
      offsetFailed: false,
    });
  });

  it('keeps pointed tools free of flat-tip residual diagnostics', () => {
    expect(vcarveTipReachability([band(0.3)], 0)).toEqual({
      residualThin: false,
      offsetFailed: false,
    });
  });
});

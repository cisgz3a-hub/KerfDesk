// Two factors are one resize when they differ by no more than a solved size
// can tell apart (ADR-573 Amendment 2, rolling audit v8 N5-P2-1).
import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM } from './scene-object';
import { retainedSourceScale } from './retained-source-scale';

const plate = { minX: 0, minY: 0, maxX: 60, maxY: 30 };

function scaleOf(scaleX: number, scaleY: number, bounds = plate) {
  return retainedSourceScale({ bounds, transform: { ...IDENTITY_TRANSFORM, scaleX, scaleY } });
}

describe('retainedSourceScale', () => {
  it('reads factors a solver tolerance apart as one resize', () => {
    expect(scaleOf(2, 2)).toEqual({ kind: 'even', factor: 2 });
    // The audit's widest pair: 4.0e-8 apart, from a sketch solved to 1e-6 mm.
    expect(scaleOf(2.00000008, 2)).toEqual({ kind: 'even', factor: 2.00000008 });
    expect(scaleOf(1 + 1e-8, 1)).toEqual({ kind: 'unit' });
  });

  it('keeps a stretch anyone could measure as a stretch', () => {
    expect(scaleOf(2, 1)).toEqual({ kind: 'stretched', x: 2, y: 1 });
    // 1e-5 apart is 0.6 µm across 60 mm, sixty times the solver's tolerance.
    expect(scaleOf(1.00001, 1)).toMatchObject({ kind: 'stretched' });
    expect(scaleOf(-2, 0)).toMatchObject({ kind: 'stretched' });
  });

  it('folds the factor of the longer side, which is measured more closely', () => {
    const tall = { minX: 0, minY: 0, maxX: 0.5, maxY: 100 };
    expect(scaleOf(2.00001, 2, tall)).toEqual({ kind: 'even', factor: 2 });
  });

  it('reads a resize along a line with no height as even', () => {
    const line = { minX: 0, minY: 0, maxX: 60, maxY: 0 };
    expect(scaleOf(2, 1, line)).toEqual({ kind: 'even', factor: 2 });
  });
});

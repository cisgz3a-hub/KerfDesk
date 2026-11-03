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
    // 0.01 mm taller on a 30 mm side, eight times an inch field's rounding.
    expect(scaleOf(1, 1 + 0.01 / 30)).toMatchObject({ kind: 'stretched' });
    expect(scaleOf(2, 2 + 0.01 / 30)).toMatchObject({ kind: 'stretched' });
    expect(scaleOf(-2, 0)).toMatchObject({ kind: 'stretched' });
  });

  // R6-P2-2 (rolling audit v9): a size typed as the toolbar shows it is
  // rounded to 3 decimals in mm, 4 in inches (ADR-573 Amendment 4).
  it('reads sizes typed at the fields precision as one resize', () => {
    // 120 x 70 typed to W 100, H 58.333: the factors are 5.7e-6 apart.
    const sketch = { minX: 0, minY: 0, maxX: 120, maxY: 70 };
    expect(scaleOf(100 / 120, 58.333 / 70, sketch)).toEqual({ kind: 'even', factor: 100 / 120 });
    // 1e-5 apart is 0.6 µm across 60 mm, inside a field's rounding.
    expect(scaleOf(1.00001, 1)).toEqual({ kind: 'unit' });
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

import { describe, expect, it } from 'vitest';
import { evaluateRasterBudget, rasterBudget } from './raster-budget';

describe('raster budget', () => {
  it('passes a modest grid (100x100mm @ 10 lines/mm = 1000x1000 px)', () => {
    expect(evaluateRasterBudget(1000, 1000).kind).toBe('ok');
  });

  it('rejects a huge grid (400x400mm @ 50 lines/mm = 20000x20000 px)', () => {
    expect(evaluateRasterBudget(20000, 20000).kind).toBe('too-large');
  });

  it('allows 25 lines/mm when the measured working set fits', () => {
    // 50x50mm @ 25/mm = 1250x1250 = 1.56M px -> ok
    expect(evaluateRasterBudget(1250, 1250).kind).toBe('ok');
    // 100x100mm @ 25/mm = 2500x2500 = 6.25M px -> 50 MB materialized
    expect(evaluateRasterBudget(2500, 2500).kind).toBe('ok');
  });

  it('allows a large local-dither raster only when rows are streamed', () => {
    expect(
      evaluateRasterBudget(6000, 6000, {
        sourcePixelCount: 1_000_000,
        ditherAlgorithm: 'threshold',
      }).kind,
    ).toBe('too-large');
    expect(
      evaluateRasterBudget(6000, 6000, {
        sourcePixelCount: 1_000_000,
        ditherAlgorithm: 'threshold',
        streamedRows: true,
      }).kind,
    ).toBe('ok');
  });

  it('accounts for multiple raster passes as measured work', () => {
    const verdict = evaluateRasterBudget(5000, 5000, {
      ditherAlgorithm: 'threshold',
      passes: 3,
      streamedRows: true,
    });
    expect(verdict.kind).toBe('too-large');
    expect(verdict.budget.workUnits).toBe(75_000_000);
  });

  it('rejects non-finite or zero dimensions', () => {
    expect(evaluateRasterBudget(0, 1000).kind).toBe('too-large');
    expect(evaluateRasterBudget(Number.POSITIVE_INFINITY, 1000).kind).toBe('too-large');
    expect(evaluateRasterBudget(Number.NaN, 1000).kind).toBe('too-large');
  });

  it('estimates working bytes from the pixel count', () => {
    const b = rasterBudget(1000, 1000);
    expect(b.pixelCount).toBe(1_000_000);
    expect(b.estimatedWorkingBytes).toBe(8_000_000);
  });
});

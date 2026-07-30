import { describe, expect, it } from 'vitest';
import { rasterPixelRuns, rasterSweepRunsForPixelRun } from './raster-power-runs';

describe('raster power runs', () => {
  it('splits exact S values without merging adjacent grayscale power', () => {
    expect(rasterPixelRuns(Uint16Array.of(1000, 608, 0), { firstX: 0, lastX: 2 })).toEqual([
      { firstX: 0, lastX: 0, s: 1000 },
      { firstX: 1, lastX: 1, s: 608 },
      { firstX: 2, lastX: 2, s: 0 },
    ]);
  });

  it('preserves historical coordinate ordering at the controller boundary', () => {
    expect(
      rasterSweepRunsForPixelRun({
        run: { firstX: 0, lastX: 0, s: 500 },
        pixelWidthMm: 0.041667,
        isReverse: false,
        dotWidthCorrectionMm: 0.0207,
        minXWorldMm: 1,
      }),
    ).toEqual([
      { startXWorldMm: 1, endXWorldMm: 1.0207, s: 0 },
      { startXWorldMm: 1.0207, endXWorldMm: 1.020967, s: 500 },
      { startXWorldMm: 1.020967, endXWorldMm: 1.041667, s: 0 },
    ]);
  });
});

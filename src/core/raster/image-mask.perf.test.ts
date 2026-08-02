import { describe, expect, it } from 'vitest';
import { maskCirclePoints, maskShape } from '../../__fixtures__/mask-shape';
import { IDENTITY_TRANSFORM, type RasterImage } from '../scene';
import { applyImageMaskToLuma } from './image-mask';

// A traced mask contour carries thousands of points; a real engrave grid
// carries hundreds of thousands of pixels. Both are modest by production
// standards (a 5 MP engrave under a 2000-point mask is 25x this workload).
const MASK_CONTOUR_POINTS = 2000;
const GRID_WIDTH = 700;
const GRID_HEIGHT = 700;
// Tripwire for the O(outputPixels x contourPoints) regression. Walking every
// contour segment for every pixel takes tens of seconds on this workload; the
// per-row scanline takes well under a second even under parallel-suite CPU
// contention. 5 s sits far above that and far below the blowup.
const MAX_MASK_ELAPSED_MS = 5000;
const PERF_TEST_TIMEOUT_MS = 120_000;

function maskedRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: GRID_WIDTH,
    pixelHeight: GRID_HEIGHT,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    imageMaskId: 'M1',
  };
}

describe('applyImageMaskToLuma — performance (mask compile blowup)', () => {
  // The mask test ran a full even-odd point-in-polygon over EVERY contour
  // segment for EVERY output pixel. This path is shared with the real job
  // compile, so a traced mask over a large engrave stalled the compile for
  // minutes. Row crossings are identical for every pixel on a row, so a
  // correct implementation pays the contour walk once per ROW.
  it(
    'masks a large grid under a many-point contour without stalling',
    () => {
      const mask = maskShape('M1', maskCirclePoints(MASK_CONTOUR_POINTS, 40, 50, 50));
      const luma = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);

      const started = performance.now();
      const masked = applyImageMaskToLuma({
        image: maskedRaster(),
        maskObject: mask,
        luma,
        width: GRID_WIDTH,
        height: GRID_HEIGHT,
      });
      const elapsedMs = performance.now() - started;

      // Centre is inside the circle (untouched), corner is outside (whitened).
      expect(masked[Math.floor(GRID_HEIGHT / 2) * GRID_WIDTH + Math.floor(GRID_WIDTH / 2)]).toBe(0);
      expect(masked[0]).toBe(255);
      expect(elapsedMs).toBeLessThan(MAX_MASK_ELAPSED_MS);
    },
    PERF_TEST_TIMEOUT_MS,
  );
});

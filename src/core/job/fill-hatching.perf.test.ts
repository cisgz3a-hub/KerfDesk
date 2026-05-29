import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { square } from '../../__fixtures__/square';
import { fillHatching } from './fill-hatching';

// Number of small contours to fill — models a traced "big image".
const BIG_IMAGE_CONTOURS = 35000;
// Tripwire for the O(scanlines × edges) regression. The naive sweep takes
// ~9 s on this workload; the active-edge sweep takes ~0.4 s in isolation but
// can reach ~1.8 s when the full suite runs it under parallel CPU contention.
// 5 s sits well above that worst case and well below the 9 s blowup, so it
// catches a real regression without flaking on a loaded machine.
const MAX_FILL_ELAPSED_MS = 5000;

describe('fillHatching — performance (big-image freeze regression)', () => {
  // A traced "big image" decomposes into thousands of small contours. The
  // original scanline walked EVERY edge of EVERY contour for EVERY scanline
  // (O(scanlines × edges)) — flipping a layer to Fill froze the whole app
  // because the canvas redraw + live ETA both ran this synchronously. This
  // models that shape: many small squares scattered down the bed, each
  // spanning only a thin Y-band so a correct active-edge sweep touches few
  // edges per scanline. The naive version cannot finish in time.
  function manySmallSquares(count: number, side: number, spanY: number): Polyline[] {
    const out: Polyline[] = [];
    const columns = 100;
    for (let i = 0; i < count; i += 1) {
      const y = (i / count) * spanY;
      const x = (i % columns) * side * 2;
      out.push(square(side, x, y));
    }
    return out;
  }

  it('fills tens of thousands of contours without freezing', () => {
    const polylines = manySmallSquares(BIG_IMAGE_CONTOURS, 2, 300);
    const started = performance.now();
    const result = fillHatching({ polylines, hatchAngleDeg: 0, hatchSpacingMm: 0.05 });
    const elapsedMs = performance.now() - started;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(MAX_FILL_ELAPSED_MS);
  }, 30000);
});

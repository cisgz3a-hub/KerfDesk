// Smoke test for the inline-fallback path. The actual worker
// behaviour can't be exercised here — vitest's environment doesn't
// host the `new URL('./trace-worker.ts', import.meta.url)` worker
// resolution Vite injects at build time. The fallback path IS
// exercised: ensureWorker() throws on the URL construction and
// returns null, traceImage() then runs traceImageToColoredPaths
// inline. This test verifies that fallback path returns the expected
// shape (paths + bounds) without crashing.
//
// The worker path is covered at runtime in dev / Cloudflare builds.

import { describe, expect, it } from 'vitest';

import type { RawImageData } from '../../core/trace';
import { traceImage } from './use-trace-worker-client';

// Build a tiny synthetic image — single black pixel surrounded by
// white. Just enough that imagetracerjs has *something* to trace,
// without paying the full lazy-load cost on every test.
function tinyImage(): RawImageData {
  const w = 4;
  const h = 4;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  // One black pixel in the middle.
  const centre = (1 * w + 1) * 4;
  data[centre] = 0;
  data[centre + 1] = 0;
  data[centre + 2] = 0;
  return { width: w, height: h, data };
}

describe('traceImage (worker client with inline fallback)', () => {
  it('returns paths + bounds when Worker is unavailable', async () => {
    const result = await traceImage(tinyImage(), {
      numberOfColors: 2,
      pathOmit: 0,
      lineTolerance: 1,
      quadraticTolerance: 1,
      blurRadius: 0,
      blurDelta: 0,
      lineFilter: false,
      fixedPalette: ['#ffffff', '#000000'],
    });
    expect(result).toHaveProperty('paths');
    expect(result).toHaveProperty('bounds');
    expect(Array.isArray(result.paths)).toBe(true);
    // Bounds must be finite numbers — no NaN / Infinity leaking
    // out from a no-result trace.
    expect(Number.isFinite(result.bounds.minX)).toBe(true);
    expect(Number.isFinite(result.bounds.maxY)).toBe(true);
  });
});

// Smoke test for the inline-fallback path. Vitest's environment doesn't
// host the production worker bundle resolution Vite injects at build
// time, so the fallback path IS
// exercised: ensureWorker() throws on the URL construction and
// returns null, traceImage() then runs traceImageToColoredPaths
// inline. This test verifies that fallback path returns the expected
// shape (paths + bounds) without crashing.
//
// The worker path is covered at runtime in dev / Cloudflare builds.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RawImageData } from '../../core/trace';
import { canTraceInline, traceImage } from './use-trace-worker-client';

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
  it('uses Vite-recognized inline worker construction for production large traces', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/ui/trace/use-trace-worker-client.ts'),
      'utf8',
    );
    const compact = source.replace(/\s+/g, ' ');

    expect(compact).toMatch(
      /new Worker\(new URL\('\.\/trace-worker\.ts', import\.meta\.url\), \{ type: 'module',? \}\)/,
    );
    expect(compact).not.toContain(
      "const workerUrl = new URL('./trace-worker.ts', import.meta.url); workerInstance = new Worker(workerUrl",
    );
  });

  it('allows inline fallback only for bounded images', () => {
    expect(canTraceInline({ width: 400, height: 400 })).toBe(true);
    expect(canTraceInline({ width: 401, height: 400 })).toBe(false);
  });

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

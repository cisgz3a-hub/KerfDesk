// Performance gauge for the centerline rework. The user's #1 complaint is that
// big images time out (30s worker ceiling) and lag the app. The legacy
// Zhang-Suen thinner is O(iterations x W x H) and allocates a neighbour array
// per ink pixel per pass, so a multi-megapixel image with thick strokes blows
// the budget. This times the real tracer on a big grid of thick strokes and
// logs the number; the rework must bring it well under the worker ceiling.

import { describe, expect, it } from 'vitest';
import type { RawImageData } from '../../core/trace';
import { TRACE_PRESETS, traceCenterlineStrokePaths } from '../../core/trace';

const RGBA = 4;
const BLACK = 0;
const WHITE = 255;

// A big white image with a grid of thick black bands — lots of ink, many
// junctions, and a stroke width that forces many thinning iterations.
function gridImage(width: number, height: number, stroke: number, spacing: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * RGBA).fill(WHITE);
  const half = Math.floor(stroke / 2);
  const ink = (x: number, y: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const base = (y * width + x) * RGBA;
    data[base] = BLACK;
    data[base + 1] = BLACK;
    data[base + 2] = BLACK;
  };
  for (let cy = spacing; cy < height; cy += spacing) {
    for (let dy = -half; dy <= half; dy += 1) for (let x = 0; x < width; x += 1) ink(x, cy + dy);
  }
  for (let cx = spacing; cx < width; cx += spacing) {
    for (let dx = -half; dx <= half; dx += 1) for (let y = 0; y < height; y += 1) ink(cx + dx, y);
  }
  return { width, height, data };
}

const CENTERLINE_OPTIONS = TRACE_PRESETS['Centerline']!;
const WORKER_TIMEOUT_MS = 30_000;
const REGRESSION_BUDGET_MS = 8_000;

describe('centerline trace performance on a big image', () => {
  it('traces a ~1.9MP thick-stroke grid within the regression budget', { timeout: 90_000 }, () => {
    const image = gridImage(1600, 1200, 24, 140);
    const start = performance.now();
    const paths = traceCenterlineStrokePaths(image, CENTERLINE_OPTIONS);
    const elapsedMs = performance.now() - start;
    console.log(
      `[centerline-perf] 1600x1200 stroke24: ${elapsedMs.toFixed(0)}ms, paths=${paths.length}`,
    );
    expect(elapsedMs).toBeLessThan(REGRESSION_BUDGET_MS);
    expect(elapsedMs).toBeLessThan(WORKER_TIMEOUT_MS);
  });
});

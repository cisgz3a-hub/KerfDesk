import { describe, expect, it } from 'vitest';
import { compareMasks } from '../../__fixtures__/perceptual/compare';
import { rasterizeColoredPaths } from '../../__fixtures__/perceptual/rasterize';
import { PERCEPTUAL_FIXTURES } from '../../__fixtures__/perceptual/shapes';
import { TRACE_PRESETS } from './trace-presets';
import type { TraceOptions } from './trace-image';
import {
  optimizationToleranceScaleFromOptimize,
  traceImageToContourColoredPaths,
} from './contour-trace';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

// Floors sit just under the values measured at introduction (2026-07-07:
// square/plus/glyph 1.000, disc 0.997, ring 0.989) so a fidelity regression
// trips while discretization noise does not.
const EXPECTED_MIN_IOU: Readonly<Record<string, number>> = {
  'solid-square': 0.99,
  'filled-disc': 0.98,
  'ring-annulus': 0.97,
  'plus-stroke': 0.99,
  'square-glyph': 0.99,
};

describe('traceImageToContourColoredPaths', () => {
  it('maps Optimize onto a real geometry tolerance with 0.2 as the neutral default', () => {
    expect(optimizationToleranceScaleFromOptimize(undefined)).toBe(1);
    expect(optimizationToleranceScaleFromOptimize(0.2)).toBe(1);
    expect(optimizationToleranceScaleFromOptimize(0)).toBeLessThan(1);
    expect(optimizationToleranceScaleFromOptimize(2)).toBeGreaterThan(1);
  });

  it.each(PERCEPTUAL_FIXTURES)('$name: covers the source ink', (fixture) => {
    const paths = traceImageToContourColoredPaths(fixture.image, LINE_ART);
    const mask = rasterizeColoredPaths(paths, fixture.width, fixture.height);
    const iou = compareMasks(mask, fixture.truth).iou;
    expect(iou).toBeGreaterThanOrEqual(EXPECTED_MIN_IOU[fixture.name] ?? 0.97);
  });

  it('emits no empty or degenerate polylines', () => {
    for (const fixture of PERCEPTUAL_FIXTURES) {
      const paths = traceImageToContourColoredPaths(fixture.image, LINE_ART);
      for (const polyline of paths.flatMap((p) => p.polylines)) {
        expect(polyline.closed).toBe(true);
        expect(polyline.points.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps the counter of an O-like ring hollow (regression: solid HOUSE "O")', () => {
    // A thick oval ring like the arch-house letter counter that used to trace
    // solid: the hole loop died in the single-corner ring collapse.
    const size = 64;
    const data = new Uint8ClampedArray(size * size * 4);
    const truth = new Uint8Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x + 0.5 - size / 2) / 22;
        const dy = (y + 0.5 - size / 2) / 28;
        const r = Math.hypot(dx, dy);
        const inked = r <= 1 && r >= 0.55;
        const value = inked ? 0 : 255;
        const base = (y * size + x) * 4;
        data[base] = value;
        data[base + 1] = value;
        data[base + 2] = value;
        data[base + 3] = 255;
        truth[y * size + x] = inked ? 1 : 0;
      }
    }
    const paths = traceImageToContourColoredPaths({ width: size, height: size, data }, LINE_ART);
    const loops = paths.flatMap((p) => p.polylines);
    expect(loops.length).toBe(2);
    const mask = rasterizeColoredPaths(paths, size, size);
    const metrics = compareMasks(mask, { width: size, height: size, data: truth });
    // The hole must stay hollow: filling it would crater precision.
    expect(metrics.precision).toBeGreaterThanOrEqual(0.95);
    expect(metrics.iou).toBeGreaterThanOrEqual(0.9);
  });
});

// Audit 07-P2-1: on a tapered (fractional) supersample grid (ADR-438) the
// Sketch / automatic-detail / Faint lines window must stay a whole number of
// pixels. A fractional radius read the integral image between its cells, so
// every interior box counted as empty: Line + fill with Sketch then traced
// one corner triangle in place of the drawing.
import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { mergeLightBurnTraceSettings } from '../../ui/trace/trace-options';
import { HYBRID_FILL_COLOR, HYBRID_STROKE_COLOR } from './hybrid/hybrid-paths';
import {
  DEFAULT_TRACE_OPTIONS,
  prepareTraceForContour,
  sketchWindowRadiusPx,
  type RawImageData,
  type TraceOptions,
} from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';
import { traceScalePlan } from './trace-upscale-policy';

const sketch = (preset: string): TraceOptions =>
  mergeLightBurnTraceSettings(TRACE_PRESETS[preset]!, { detectionMode: 'sketch' });

/** 2 px lines every 30 px, both ways, at the given luma on white. */
function linePage(luma: number): RawImageData {
  const n = 300;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < n; y += 1)
    for (let x = 0; x < n; x += 1)
      if (x % 30 < 2 || y % 30 < 2) data.set([luma, luma, luma, 255], (y * n + x) * 4);
  return { width: n, height: n, data };
}

function inkPixels(image: RawImageData): number {
  let ink = 0;
  for (let i = 0; i < image.data.length; i += 4) if ((image.data[i] ?? 255) < 128) ink += 1;
  return ink;
}

/** Three 2 px pen circles and a diagonal on white: 4.03 n of stroke. */
function penDrawing(n: number): RawImageData {
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  const dab = (x: number, y: number): void => {
    for (let dy = 0; dy < 2; dy += 1)
      for (let dx = 0; dx < 2; dx += 1) {
        const px = Math.round(x) + dx;
        const py = Math.round(y) + dy;
        if (px >= 0 && py >= 0 && px < n && py < n) data.set([40, 40, 40, 255], (py * n + px) * 4);
      }
  };
  for (const [cx, cy, r] of [
    [0.3, 0.3, 0.15],
    [0.7, 0.35, 0.12],
    [0.5, 0.7, 0.2],
  ] as const) {
    const steps = Math.ceil(4 * Math.PI * r * n);
    for (let i = 0; i < steps; i += 1) {
      const a = (i / steps) * 2 * Math.PI;
      dab(n * (cx + r * Math.cos(a)), n * (cy + r * Math.sin(a)));
    }
  }
  for (let t = 0; t < n * 0.8; t += 0.5) dab(n * 0.1 + t, n * 0.9 - t * 0.9);
  return { width: n, height: n, data };
}

function strokeLength(lines: readonly Polyline[]): number {
  let length = 0;
  for (const { points } of lines)
    for (let i = 1; i < points.length; i += 1)
      length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return length;
}

describe('the sketch window on a tapered supersample grid', () => {
  it('rounds the window to whole working pixels', () => {
    const radius = (pixelScale: number, detectorWindowScale?: number): number =>
      sketchWindowRadiusPx({
        ...DEFAULT_TRACE_OPTIONS,
        pixelScale,
        ...(detectorWindowScale === undefined ? {} : { detectorWindowScale }),
      });
    expect([1, 1.25, 1.5, 2].map((scale) => radius(scale))).toEqual([8, 10, 12, 16]);
    // The tapered factors the audit hit (1.10 / 1.51 / 1.70 / 1.82).
    expect([1.0954, 1.5139, 1.7, 1.8243].map((scale) => radius(scale))).toEqual([9, 12, 14, 15]);
    expect(radius(1.8243, 3000 / 2048)).toBe(21);
  });

  // Before: Line Art + Sketch kept 196 of 5638 ink pixels at 1.7.
  it.each([
    ['Line Art', 'sketch', 40],
    ['Smooth', 'sketch', 40],
    ['Line + fill', 'sketch', 40],
    ['Line Art', 'faint-lines', 170],
  ] as const)('%s with %s keeps every line at fractional scales', (preset, detectionMode, luma) => {
    const options = mergeLightBurnTraceSettings(TRACE_PRESETS[preset]!, { detectionMode });
    const page = linePage(luma);
    const ink = (pixelScale: number): number =>
      inkPixels(prepareTraceForContour(page, { ...options, pixelScale }).prepared);
    const whole = ink(1);
    expect(whole).toBeGreaterThan(5000);
    for (const scale of [1.0954, 1.5139, 1.7, 1.8243, 2]) expect(ink(scale)).toBe(whole);
  });

  // Before: 900 / 950 / 1000 px traced one 5-point #000000 triangle at the
  // bottom-right corner; 840 (exact 2x) and 1050 (native) traced the drawing.
  it.each([
    [840, 'whole'],
    [900, 'tapered'],
    [950, 'tapered'],
    [1000, 'tapered'],
    [1050, 'native'],
  ] as const)(
    'Line + fill with Sketch traces a %i px pen drawing (%s grid)',
    async (n, grid) => {
      const options = sketch('Line + fill');
      const image = penDrawing(n);
      const plan = traceScalePlan(image, options);
      const factor = plan.kind === 'upscale' ? plan.factor : 1;
      expect(grid === 'tapered' ? !Number.isInteger(factor) : Number.isInteger(factor)).toBe(true);

      const paths = await traceImageToColoredPaths(image, options);
      const strokes = paths.filter((path) => path.color === HYBRID_STROKE_COLOR);
      const length = strokeLength(strokes.flatMap((path) => path.polylines)) / n;
      expect(length).toBeGreaterThan(3.8);
      expect(length).toBeLessThan(4.3);
      // Only stroke crossings may become fills, and nothing hugs the corner.
      const fills = paths.filter((path) => path.color === HYBRID_FILL_COLOR);
      expect(fills.flatMap((path) => path.polylines).length).toBeLessThanOrEqual(2);
      const corner = paths
        .flatMap((path) => path.polylines)
        .filter(({ points }) => points.every((p) => p.x > n - 16 && p.y > n - 16));
      expect(corner).toEqual([]);
    },
    120_000,
  );
});

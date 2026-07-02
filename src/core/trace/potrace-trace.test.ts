import { describe, expect, it } from 'vitest';

import { TRACE_PRESETS, traceImageToColoredPaths } from './index';
import { traceImageToPotraceColoredPaths } from './potrace-trace';
import type { RawImageData, TraceOptions } from './trace-image';

function imageFromMask(width: number, mask: ReadonlyArray<number>): RawImageData {
  const data = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i += 1) {
    const v = mask[i] === 1 ? 0 : 255;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width, height: mask.length / width, data };
}

const lineArtPreset = TRACE_PRESETS['Line Art'];
if (lineArtPreset === undefined) throw new Error('Missing Line Art preset');

const straightLineArt: TraceOptions = {
  ...lineArtPreset,
  smoothness: 0,
  optimize: 0,
  ignoreLessThanPixels: 0,
  despeckleMinPixels: 0,
};

describe('traceImageToPotraceColoredPaths', () => {
  it('traces a single ink pixel as one closed black polyline', () => {
    const result = traceImageToPotraceColoredPaths(imageFromMask(1, [1]), straightLineArt);

    expect(result).toHaveLength(1);
    expect(result[0]?.color).toBe('#000000');
    expect(result[0]?.polylines).toHaveLength(1);
    const polyline = result[0]?.polylines[0];
    const points = polyline?.points ?? [];
    expect(polyline?.closed).toBe(true);
    expect(points.length).toBeGreaterThanOrEqual(5);
    expect(points[0]).toEqual(points[points.length - 1]);
    expect(Math.min(...points.map((p) => p.x))).toBe(0);
    expect(Math.min(...points.map((p) => p.y))).toBe(0);
    expect(Math.max(...points.map((p) => p.x))).toBe(1);
    expect(Math.max(...points.map((p) => p.y))).toBe(1);
  });

  it('uses the Potrace backend for Line Art filled-contour tracing', async () => {
    const image = imageFromMask(4, [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);

    const direct = traceImageToPotraceColoredPaths(image, straightLineArt);
    const routed = await traceImageToColoredPaths(image, straightLineArt);

    expect(routed).toEqual(direct);
  });

  // The Sharp preset's reason to exist: small drawn features keep their
  // corners. Default smoothness (1.0) turns a 4×4 square dot into a rounded
  // blob; Sharp must keep a vertex at each corner.
  it('Sharp keeps the corners of a small square that default smoothness rounds off', () => {
    const sharp = TRACE_PRESETS['Sharp'];
    if (sharp === undefined) throw new Error('Missing Sharp preset');
    const side = 10;
    const mask = Array.from({ length: side * side }, (_, i) => {
      const x = i % side;
      const y = (i - x) / side;
      return x >= 3 && x < 7 && y >= 3 && y < 7 ? 1 : 0;
    });
    const image = imageFromMask(side, mask);
    const corners = [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 7 },
    ];
    const worstCornerMiss = (options: TraceOptions): number => {
      const points =
        traceImageToPotraceColoredPaths(image, options)[0]?.polylines[0]?.points ?? [];
      let worst = 0;
      for (const corner of corners) {
        let best = Infinity;
        for (const p of points) best = Math.min(best, Math.hypot(p.x - corner.x, p.y - corner.y));
        worst = Math.max(worst, best);
      }
      return worst;
    };
    expect(worstCornerMiss(sharp)).toBeLessThan(0.7);
    // Contrast: the same trace at default smoothness misses corners — this is
    // what guards the preset's smoothness value from silently regressing.
    expect(worstCornerMiss({ ...sharp, smoothness: 1, optimize: 0.2 })).toBeGreaterThan(0.7);
  });
});

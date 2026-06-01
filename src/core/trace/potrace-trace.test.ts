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
});

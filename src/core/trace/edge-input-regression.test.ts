import { describe, expect, it } from 'vitest';
import { mergeLightBurnTraceSettings } from '../../ui/trace/trace-options';
import { traceImageToColoredPaths } from './trace-to-paths';
import { traceScalePlan } from './trace-upscale-policy';
import { TRACE_PRESETS } from './trace-presets';
import type { RawImageData } from './trace-image';

const edge = TRACE_PRESETS['Edge Detection']!;
function paper(size: number): RawImageData {
  return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(255) };
}
function rect(
  image: RawImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  value: number,
): void {
  for (let py = y; py < y + height; py++)
    for (let px = x; px < x + width; px++) {
      const i = (py * image.width + px) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    }
}

describe('Edge input and quality resolution', () => {
  it('retains five clean one-pixel lines when the working budget requires native resolution', async () => {
    const image = paper(1024);
    for (const y of [100, 250, 400, 550, 700]) rect(image, 60, y, 904, 1, 0);
    expect(traceScalePlan(image, edge)).toEqual({ kind: 'native' });
    const paths = await traceImageToColoredPaths(image, edge);
    expect(paths.flatMap((p) => p.polylines)).toHaveLength(5);
    expect(paths).toEqual(
      await traceImageToColoredPaths(image, { ...edge, edgeMedianFilter: false }),
    );
  });

  it('uses pale local detail for quality resolution, independent of hidden filled-preset settings', async () => {
    const image = paper(320);
    rect(image, 30, 30, 100, 100, 0);
    rect(image, 220, 30, 2, 90, 200);
    const expected = await traceImageToColoredPaths(image, edge);
    expect(traceScalePlan(image, edge)).toEqual({ kind: 'upscale', factor: 2 });
    for (const overrides of [
      { detectionMode: 'manual' as const, cutoffLuma: 180, thresholdLuma: 230 },
      { detectionMode: 'manual' as const, cutoffLuma: 250, thresholdLuma: 254 },
      { detectionMode: 'sketch' as const },
      { despeckleMinPixels: 10000, ignoreLessThanPixels: 10000 },
      { traceTransparency: true },
    ]) {
      const options = mergeLightBurnTraceSettings(edge, overrides);
      expect(traceScalePlan(image, options)).toEqual(traceScalePlan(image, edge));
      expect(await traceImageToColoredPaths(image, options)).toEqual(expected);
    }
  });
});

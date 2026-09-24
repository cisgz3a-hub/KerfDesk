import { describe, expect, it } from 'vitest';
import type { RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceScalePlan } from './trace-upscale-policy';
import { prepareTraceForContour } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';

function densePaleLines(width: number, height: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1)
    for (let x = 4; x < width; x += 8) data.set([180, 180, 180, 255], (y * width + x) * 4);
  return { width, height, data };
}

describe('faint-line resolution budget', () => {
  const options = {
    ...TRACE_PRESETS['Line Art']!,
    faintLineRecovery: true,
    autoSketchTrace: false,
    sketchTrace: false,
  };

  it('does not multiply dense recovered detail into an unnecessary 2x grid', () => {
    expect(traceScalePlan(densePaleLines(800, 600), options)).toEqual({ kind: 'native' });
  });

  it('keeps the existing bounded working grid for large dense local-detail inputs', () => {
    const plan = traceScalePlan(densePaleLines(1600, 1000), options);
    expect(plan.kind).toBe('downscale');
    if (plan.kind === 'downscale') expect(plan.width * plan.height).toBeLessThanOrEqual(1_260_000);
  });

  it('preserves Sharp native resolution when faint recovery is enabled', () => {
    expect(
      traceScalePlan(densePaleLines(1600, 1000), {
        ...TRACE_PRESETS['Sharp']!,
        faintLineRecovery: true,
      }),
    ).toEqual({ kind: 'native' });
  });

  it('keeps alpha-owned masks, resolution and final paths independent of hidden faint detection', async () => {
    const image = densePaleLines(1600, 1000);
    for (let y = 0; y < image.height; y += 1)
      for (let x = 0; x < image.width; x += 1)
        image.data.set([255, 255, 255, x % 8 === 4 ? 255 : 0], (y * image.width + x) * 4);
    const alpha = { ...TRACE_PRESETS['Line Art']!, traceTransparency: true };
    const faint = { ...alpha, faintLineRecovery: true, autoSketchTrace: false, sketchTrace: false };
    const nativeMask = prepareTraceForContour(image, alpha).prepared.data;
    const faintMask = prepareTraceForContour(image, faint).prepared.data;
    expect(faintMask.every((value, index) => value === nativeMask[index])).toBe(true);
    expect(traceScalePlan(image, faint)).toEqual(traceScalePlan(image, alpha));
    const expected = await traceImageToColoredPaths(image, alpha);
    expect(expected.reduce((sum, path) => sum + path.polylines.length, 0)).toBe(200);
    expect(await traceImageToColoredPaths(image, faint)).toEqual(expected);
  }, 20_000);
});

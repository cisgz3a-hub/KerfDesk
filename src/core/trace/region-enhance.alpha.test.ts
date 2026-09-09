import { expect, it } from 'vitest';
import {
  alphaForegroundAt,
  alphaRgbDetail,
  DETAIL_ALPHA_REGION,
} from '../../__fixtures__/trace-alpha';
import { enhanceRegionPaths } from './region-enhance';
import { preprocessForTrace, type RawImageData, type TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

it('carries full-source alpha into the actual injected region tracer before supersampling', async () => {
  const image = alphaRgbDetail();
  const before = image.data.slice();
  const options = Object.freeze({ ...TRACE_PRESETS['Sharp']!, traceTransparency: true });
  const fullTracePaths = await traceImageToColoredPaths(image, options);
  const calls: Array<{ image: RawImageData; options: TraceOptions; prepared: RawImageData }> = [];
  const enhanced = await enhanceRegionPaths({
    image,
    region: DETAIL_ALPHA_REGION,
    options,
    fullTracePaths,
    trace: async (crop, derived) => {
      calls.push({ image: crop, options: derived, prepared: preprocessForTrace(crop, derived) });
      return traceImageToColoredPaths(crop, derived);
    },
  });
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(call.image).toMatchObject({ width: 56, height: 56 });
  expect(call.image.data.buffer).not.toBe(image.data.buffer);
  expect(call.options).toMatchObject({
    traceTransparency: true,
    pixelScale: 2,
    supersampleContour: false,
    autoUpscaleSmallSources: false,
    upscaleSmallSmoothSources: false,
  });
  const foreground = Array.from(call.prepared.data).filter(
    (value, index) => index % 4 === 0 && value === 0,
  ).length;
  expect(foreground).toBe(56 * 56);
  expect(alphaForegroundAt(enhanced, 32, 32)).toBe(true);
  expect(image.data).toEqual(before);
  expect(options).toEqual({ ...TRACE_PRESETS['Sharp'], traceTransparency: true });
});

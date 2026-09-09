import { describe, expect, it } from 'vitest';
import { alphaRgbDetail, DETAIL_ALPHA_REGION } from '../../__fixtures__/trace-alpha';
import { resampleBuffer } from '../image-resample';
import { resolveTraceSourceOptions } from './trace-alpha';
import { cropRawImageData } from './trace-boundary';
import { DEFAULT_TRACE_OPTIONS, preprocessForTrace } from './trace-image';

const requested = Object.freeze({ ...DEFAULT_TRACE_OPTIONS, traceTransparency: true });

describe('source-bound alpha interpretation', () => {
  it('resolves each source independently without changing the requested options or bytes', () => {
    const image = alphaRgbDetail();
    const original = image.data.slice();
    const transparent = resolveTraceSourceOptions(image, requested);
    const opaque = resolveTraceSourceOptions(alphaRgbDetail('opaque'), requested);
    expect(transparent).toEqual({ ...requested, sourceHasTransparency: true });
    expect(opaque).toEqual({ ...requested, sourceHasTransparency: false });
    expect(requested).toEqual({ ...DEFAULT_TRACE_OPTIONS, traceTransparency: true });
    expect(image.data).toEqual(original);
    const crop = cropRawImageData(image, DETAIL_ALPHA_REGION);
    expect(resolveTraceSourceOptions(crop, transparent)).toBe(transparent);
    const prepared = preprocessForTrace(crop, transparent);
    expect(Array.from(prepared.data).filter((_, index) => index % 4 === 0)).toEqual(
      Array(28 * 28).fill(0),
    );
  });

  it('retains source alpha intent when resampling rounds away its only translucent pixel', () => {
    const image = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(255) };
    image.data[3] = 254;
    const derived = resolveTraceSourceOptions(image, requested);
    const sampled = resampleBuffer(image, 1, 1);
    expect(sampled.data[3]).toBe(255);
    expect(preprocessForTrace(sampled, derived).data).toEqual(
      new Uint8ClampedArray([0, 0, 0, 255]),
    );
    // The same sampled bytes, supplied as a new opaque source, retain luminance fallback.
    expect(preprocessForTrace(sampled, requested).data).toEqual(
      new Uint8ClampedArray([255, 255, 255, 255]),
    );
  });

  it.each([
    { cutoff: 0, threshold: 128, expected: [255, 255, 0, 0] },
    { cutoff: 128, threshold: 128, expected: [255, 255, 0, 255] },
    { cutoff: 129, threshold: 128, expected: [255, 0, 0, 255] },
    { cutoff: 0, threshold: 0, expected: [255, 255, 255, 0] },
    { cutoff: 254, threshold: 254, expected: [0, 255, 255, 255] },
  ])(
    'keeps inclusive and reversed alpha bands $cutoff to $threshold',
    ({ cutoff, threshold, expected }) => {
      const data = new Uint8ClampedArray(
        [1, 126, 127, 255].flatMap((alpha) => [255, 255, 255, alpha]),
      );
      const image = { width: 4, height: 1, data };
      const derived = resolveTraceSourceOptions(image, {
        ...requested,
        cutoffLuma: cutoff,
        thresholdLuma: threshold,
      });
      expect(
        Array.from(preprocessForTrace(image, derived).data).filter((_, i) => i % 4 === 0),
      ).toEqual(expected);
    },
  );

  it('lets the requested alpha setting turn off without changing retained source interpretation', () => {
    const image = alphaRgbDetail();
    const derived = resolveTraceSourceOptions(image, requested);
    const off = { ...derived, traceTransparency: false };
    expect(preprocessForTrace(image, off)).toEqual(
      preprocessForTrace(image, { ...requested, traceTransparency: false }),
    );
    expect(derived.traceTransparency).toBe(true);
  });
});

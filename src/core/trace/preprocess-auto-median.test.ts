// AUTO median gate for the Trace preprocessing chain. Split from
// trace-image.test.ts (which is at the file-line cap) because the 'auto'
// median policy is a distinct concern: it verifies preprocessForTrace's
// medianFilter: 'auto' branch matches the forced/off paths on the right
// inputs, and that the Smooth preset adopts it.

import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACE_OPTIONS, preprocessForTrace, type RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';

function greyscaleImage(
  width: number,
  height: number,
  valueAt: (i: number) => number,
): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const v = valueAt(i);
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }
  return { width, height, data };
}

describe("preprocessForTrace medianFilter 'auto'", () => {
  it('skips the median on a clean image (equals the no-median path)', () => {
    // A crisp black-on-white edge with no impulse noise: 'auto' must decide
    // NOT to run the median, so the output is byte-identical to medianFilter
    // omitted entirely. Threshold is fixed so both paths binarise the same.
    const width = 8;
    const base = greyscaleImage(width, 8, (i) => (i % width < 4 ? 0 : 255));
    const auto = preprocessForTrace(base, {
      ...DEFAULT_TRACE_OPTIONS,
      thresholdLuma: 128,
      medianFilter: 'auto',
    });
    const off = preprocessForTrace(base, {
      ...DEFAULT_TRACE_OPTIONS,
      thresholdLuma: 128,
      medianFilter: false,
    });
    expect(Array.from(auto.data)).toEqual(Array.from(off.data));
  });

  it('applies the median on a salt-and-pepper image (equals the forced-median path)', () => {
    // Heavily peppered field: 'auto' must detect the impulse noise and run
    // the median, so the output matches medianFilter: true exactly.
    const base = greyscaleImage(12, 12, (i) => (i % 5 === 0 ? 255 : 0));
    const auto = preprocessForTrace(base, {
      ...DEFAULT_TRACE_OPTIONS,
      thresholdLuma: 128,
      medianFilter: 'auto',
    });
    const forced = preprocessForTrace(base, {
      ...DEFAULT_TRACE_OPTIONS,
      thresholdLuma: 128,
      medianFilter: true,
    });
    expect(Array.from(auto.data)).toEqual(Array.from(forced.data));
  });

  it("Smooth preset uses medianFilter 'auto' (no forced-median melt)", () => {
    expect(TRACE_PRESETS['Smooth']?.medianFilter).toBe('auto');
  });
});

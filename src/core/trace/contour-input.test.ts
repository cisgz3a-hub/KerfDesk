import { afterEach, describe, expect, it, vi } from 'vitest';
import { upscaleBy } from './auto-upscale';
import { contourTraceInputMatches, prepareContourTraceInput } from './contour-input';
import { restoreEnlargedContourSupport } from './contour-support';
import {
  traceImageToContourColoredPaths,
  traceImageToContourColoredPathsSteps,
} from './contour-trace';
import * as traceImage from './trace-image';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { runTraceSteps } from './trace-steps';
import { traceImageToColoredPaths } from './trace-to-paths';

const LINE_ART = TRACE_PRESETS['Line Art']!;
const whiteImage = (size: number): RawImageData => ({
  width: size,
  height: size,
  data: new Uint8ClampedArray(size * size * 4).fill(255),
});

function paint(image: RawImageData, x: number, y: number, luma: number): void {
  image.data.set([luma, luma, luma, 255], (y * image.width + x) * 4);
}

afterEach(() => vi.restoreAllMocks());

describe('prepared contour input', () => {
  it.each(['Line Art', 'Smooth'])(
    'prepares native %s only once for profiling and tracing',
    async (name) => {
      const image = whiteImage(320);
      for (let y = 60; y < 260; y += 1) {
        for (let x = 60; x < 260; x += 1) paint(image, x, y, 0);
      }
      const preparation = vi.spyOn(traceImage, 'prepareTraceForContour');
      const paths = await traceImageToColoredPaths(image, TRACE_PRESETS[name]!);
      expect(paths.flatMap((path) => path.polylines)).toHaveLength(1);
      expect(preparation).toHaveBeenCalledTimes(1);
    },
  );

  it("does not reuse another source or another execution's detection settings", () => {
    const image = whiteImage(64);
    for (let y = 15; y < 45; y += 1) {
      for (let x = 15; x < 45; x += 1) paint(image, x, y, 100);
    }
    const strict: TraceOptions = { ...LINE_ART, thresholdLuma: 50 };
    const input = prepareContourTraceInput(image, strict);
    expect(contourTraceInputMatches(input, image, LINE_ART)).toBe(false);
    expect(contourTraceInputMatches(input, { ...image }, strict)).toBe(false);
    expect(contourTraceInputMatches(input, image, strict)).toBe(true);
    const restored = runTraceSteps(traceImageToContourColoredPathsSteps(image, LINE_ART, input));
    expect(restored).toEqual(traceImageToContourColoredPaths(image, LINE_ART));
    expect(restored.flatMap((path) => path.polylines)).not.toHaveLength(0);
  });
});

describe('source-mask support through optional enlargement', () => {
  it('allows bilinear subpixel edges that keep both a narrow stroke and its hole', () => {
    const image = whiteImage(64);
    for (let y = 12; y < 52; y += 1) {
      for (let x = 12; x < 52; x += 1) {
        if (x < 14 || x > 49 || y < 14 || y > 49) paint(image, x, y, 0);
      }
    }
    const native = prepareContourTraceInput(image, LINE_ART);
    const enlarged = prepareContourTraceInput(upscaleBy(image, 2), { ...LINE_ART, pixelScale: 2 });
    expect(restoreEnlargedContourSupport(native, enlarged, 2)).toBe(enlarged);
    // The field still carries the gray interpolation values; the guard does
    // not convert the source to nearest-neighbour geometry or shift its cut.
    expect(enlarged.crackField?.lumaAt(24, 24)).toBeGreaterThan(0);
    expect(enlarged.crackField?.lumaAt(24, 24)).toBeLessThan(128);
  });

  it('restores a wholly erased counter with a matching local scalar field', () => {
    const paper = whiteImage(3);
    const closed = whiteImage(6);
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) if (x !== 1 || y !== 1) paint(paper, x, y, 0);
    }
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) paint(closed, x, y, 0);
    }
    const native = { image: paper, prepared: paper, options: LINE_ART, crackField: null };
    const enlarged = { image: closed, prepared: closed, options: LINE_ART, crackField: null };
    const restored = restoreEnlargedContourSupport(native, enlarged, 2);
    expect(restored.prepared.data[(2 * 6 + 2) * 4]).toBe(255);
    expect(restored.crackField?.lumaAt(2, 2)).toBeGreaterThan(128);
    expect(restored.crackField?.thresholdAt(2, 2)).toBe(128);
    expect(closed.data[(2 * 6 + 2) * 4]).toBe(0);
    expect(restored.crackField?.lumaAt(-1, -1)).toBe(255);
  });

  it('allows a coherent stroke edge to move within the nearby working samples', () => {
    const source = whiteImage(64);
    const shifted = whiteImage(128);
    for (let x = 12; x < 52; x += 1) paint(source, x, 30, 0);
    for (let x = 24; x < 104; x += 1) {
      paint(shifted, x, 62, 0);
      paint(shifted, x, 63, 0);
    }
    const native = { image: source, prepared: source, options: LINE_ART, crackField: null };
    const enlarged = { image: shifted, prepared: shifted, options: LINE_ART, crackField: null };
    expect(restoreEnlargedContourSupport(native, enlarged, 2)).toBe(enlarged);
  });
});

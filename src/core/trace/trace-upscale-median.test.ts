import { afterEach, describe, expect, it, vi } from 'vitest';
import * as medianStage from './apply-median';
import { upscaleBy } from './auto-upscale';
import { prepareContourTraceInput } from './contour-input';
import * as contourTrace from './contour-trace';
import * as preprocess from './preprocess';
import type { RawImageData, TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';
import {
  prepareUpscaledTraceInput,
  releaseMedianStage,
  sourceMedianStage,
} from './trace-upscale-input';

// ADR-411: the automatic median runs at source resolution and the cleaned
// source is enlarged, so a one-source-pixel impulse is judged as one pixel
// whatever working grid the contour lane later traces on.

const SMOOTH = TRACE_PRESETS['Smooth']!;
// Mask cleanup off, so the median alone decides what survives.
const MEDIAN_ONLY: TraceOptions = { ...SMOOTH, despeckleMinPixels: 0, fillPinholeCracks: false };
const SIZE = 64;

afterEach(() => vi.restoreAllMocks());

function paper(size = SIZE): RawImageData {
  return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(255) };
}

function paint(image: RawImageData, x: number, y: number, luma: number): void {
  image.data.set([luma, luma, luma, 255], (y * image.width + x) * 4);
}

function copy(image: RawImageData): RawImageData {
  return { ...image, data: new Uint8ClampedArray(image.data) };
}

/** A solid block (ink) on paper. */
function artwork(): RawImageData {
  const image = paper();
  for (let y = 40; y < 60; y += 1) for (let x = 36; x < 60; x += 1) paint(image, x, y, 0);
  return image;
}

type Speck = { readonly x: number; readonly y: number; readonly ink: boolean };

/** One-pixel pepper on the paper and salt in the block: 49 + 12 = 61 isolated
 * impulses, 1.5% of the frame, above the automatic median's 0.4% floor. */
function specks(): Speck[] {
  const out: Speck[] = [];
  for (let y = 3; y < 34; y += 5) for (let x = 3; x < 34; x += 5) out.push({ x, y, ink: true });
  for (let y = 43; y < 58; y += 5) for (let x = 39; x < 58; x += 5) out.push({ x, y, ink: false });
  return out;
}

function withSpecks(image: RawImageData, list: readonly Speck[]): RawImageData {
  const noisy = copy(image);
  for (const speck of list) paint(noisy, speck.x, speck.y, speck.ink ? 0 : 255);
  return noisy;
}

/** The prepared (binary) mask the contour lane traces at `factor`. */
function preparedAt(image: RawImageData, options: TraceOptions, factor: number): RawImageData {
  const native = prepareContourTraceInput(image, options);
  if (factor === 1) return native.prepared;
  const enlarged = prepareUpscaledTraceInput(image, options, factor, undefined, native);
  return enlarged.contourInput!.prepared;
}

function inkInCell(mask: RawImageData, x: number, y: number, factor: number): number {
  let ink = 0;
  for (let dy = 0; dy < factor; dy += 1) {
    for (let dx = 0; dx < factor; dx += 1) {
      if ((mask.data[((y * factor + dy) * mask.width + x * factor + dx) * 4] ?? 255) < 128) ink++;
    }
  }
  return ink;
}

describe('automatic median at source scale (ADR-411)', () => {
  it.each([1, 2, 3])('removes 1-source-px impulses identically at %ix', (factor) => {
    const clean = artwork();
    const list = specks();
    const noisy = withSpecks(clean, list);
    const cleaned = preparedAt(noisy, MEDIAN_ONLY, factor);
    // Identical to the speck-free source at the same scale, pixel for pixel.
    expect(cleaned.data).toEqual(preparedAt(clean, MEDIAN_ONLY, factor).data);
    for (const speck of list) {
      expect(inkInCell(cleaned, speck.x, speck.y, factor)).toBe(speck.ink ? 0 : factor * factor);
    }
  });

  it.each([2, 3])('fixes the working-grid median, which keeps the enlarged specks at %ix', (f) => {
    // The previous order: enlarge first, then median on the working grid.
    // Each speck is a supported f x f blob there, so the repair skipped it.
    const late = (image: RawImageData): RawImageData =>
      prepareContourTraceInput(upscaleBy(image, f), { ...MEDIAN_ONLY, pixelScale: f }).prepared;
    const noisy = late(withSpecks(artwork(), specks()));
    const clean = late(artwork());
    const kept = specks().filter(
      (s) => inkInCell(noisy, s.x, s.y, f) !== inkInCell(clean, s.x, s.y, f),
    );
    expect(kept).toHaveLength(specks().length);
  });

  type Feature = readonly [string, (image: RawImageData) => void];
  const FEATURES: readonly Feature[] = [
    ['connected 1 px hairline', (i) => rows(i, [[4, 30, 60]])],
    ['vertical 1 px hairline', (i) => cols(i, [[62, 2, 30]])],
    ['diagonal 1 px hairline', (i) => diagonal(i, 4, 36, 26)],
    ['anti-diagonal 1 px hairline', (i) => antiDiagonal(i, 32, 36, 26)],
    [
      '2 px pitch grating',
      (i) =>
        rows(
          i,
          [36, 38, 40, 42].map((y) => [y, 2, 30]),
        ),
    ],
    ['2 px cell grid', (i) => grid(i, 2, 36, 30, 3)],
  ];

  it.each(FEATURES)('leaves a %s unchanged at 1x, 2x and 3x', (_name, draw) => {
    const clean = artwork();
    draw(clean);
    // Specks away from the feature make the automatic median fire.
    const noisy = withSpecks(
      clean,
      specks().filter((s) => farFromInk(clean, s)),
    );
    expect(preprocess.autoMedianFilter(noisy)).not.toBe(noisy);
    for (const factor of [1, 2, 3]) {
      expect(preparedAt(noisy, MEDIAN_ONLY, factor).data).toEqual(
        preparedAt(clean, MEDIAN_ONLY, factor).data,
      );
    }
  });

  it('runs the automatic median only on the source grid, reusing the native pass', () => {
    const noisy = withSpecks(artwork(), specks());
    const median = vi.spyOn(medianStage, 'applyMedian');
    const auto = vi.spyOn(preprocess, 'autoMedianFilter');
    const native = prepareContourTraceInput(noisy, MEDIAN_ONLY);
    prepareUpscaledTraceInput(noisy, MEDIAN_ONLY, 3, undefined, native);
    const autoCalls = median.mock.calls.filter(([, option]) => option === 'auto');
    expect(autoCalls.map(([image]) => image.width)).toEqual([SIZE]);
    // The native pass's one selective median; the upscale route reuses it.
    expect(auto.mock.calls.map(([image]) => image.width)).toEqual([SIZE]);
  });

  it('computes the same source median when no native pass is available', () => {
    const noisy = withSpecks(artwork(), specks());
    const native = prepareContourTraceInput(noisy, MEDIAN_ONLY);
    const own = sourceMedianStage(noisy, MEDIAN_ONLY);
    expect(own?.cleaned.data).toEqual(native.median?.cleaned.data);
    expect(prepareUpscaledTraceInput(noisy, MEDIAN_ONLY, 2).image.data).toEqual(
      prepareUpscaledTraceInput(noisy, MEDIAN_ONLY, 2, undefined, native).image.data,
    );
  });

  it('keeps the source and its tone controls when the median repairs nothing', () => {
    const clean = artwork();
    const toned: TraceOptions = { ...MEDIAN_ONLY, brightness: 20, gamma: 1.4 };
    const enlarged = prepareUpscaledTraceInput(clean, toned, 2);
    expect(enlarged.image.data).toEqual(upscaleBy(clean, 2).data);
    expect(enlarged.options).toMatchObject({ brightness: 20, gamma: 1.4, medianFilter: false });
  });

  it('enlarges the toned, repaired source once and clears the tone controls', () => {
    const noisy = withSpecks(artwork(), specks());
    const toned: TraceOptions = { ...MEDIAN_ONLY, contrast: 30 };
    const enlarged = prepareUpscaledTraceInput(noisy, toned, 2);
    expect(enlarged.options).toMatchObject({ contrast: 0, gamma: 1, medianFilter: false });
    const stage = sourceMedianStage(noisy, toned)!;
    expect(enlarged.image.data).toEqual(upscaleBy(stage.cleaned, 2).data);
  });

  it('releases the median stage wherever no later grid resamples it', async () => {
    const noisy = withSpecks(artwork(), specks());
    const toned: TraceOptions = { ...MEDIAN_ONLY, brightness: 20 };
    const native = prepareContourTraceInput(noisy, toned);
    expect(native.median?.cleaned).not.toBe(native.median?.adjusted);
    const released = releaseMedianStage(native);
    expect(released.median).toBeUndefined();
    expect(released).toMatchObject({ image: noisy, options: toned, prepared: native.prepared });
    expect(releaseMedianStage(released)).toBe(released);
    // The working grid's stage (a 4x tone-adjusted copy here) is not kept.
    for (const source of [noisy, artwork()]) {
      const working = prepareUpscaledTraceInput(source, toned, 2, undefined, native);
      expect(working.contourInput?.prepared.width).toBe(SIZE * 2);
      expect(working.contourInput?.median).toBeUndefined();
    }
    // A broad native trace (no upscale) hands the contour lane no stage.
    const lane = vi.spyOn(contourTrace, 'traceImageToContourColoredPathsSteps');
    const broad = paper(200);
    for (let y = 40; y < 160; y += 1) for (let x = 40; x < 160; x += 1) paint(broad, x, y, 0);
    await traceImageToColoredPaths(broad, { ...SMOOTH, brightness: 20 });
    expect(lane).toHaveBeenCalledTimes(1);
    const handed = lane.mock.calls[0]?.[2];
    expect(handed?.prepared.width).toBe(200);
    expect(handed?.median).toBeUndefined();
  });

  it('pins the documented halftone escape: only Sharp keeps isolated 1 px dots', () => {
    // A 1 px dot lattice on paper and a 1 px hole lattice in ink. Smooth and
    // Line Art drop the dots and fill the holes through despeckle and pinhole
    // fill, with or without the median; Sharp (no median, no pinhole fill,
    // despeckle 1) keeps both (ADR-411 item 3, WORKFLOW trace settings).
    const dots = paper();
    for (let y = 4; y < 60; y += 3) for (let x = 4; x < 60; x += 3) paint(dots, x, y, 0);
    const holes = paper();
    for (let y = 4; y < 60; y += 1) for (let x = 4; x < 60; x += 1) paint(holes, x, y, 0);
    for (let y = 6; y < 58; y += 3) for (let x = 6; x < 58; x += 3) paint(holes, x, y, 255);
    const count = (mask: RawImageData, ink: boolean): number => {
      let n = 0;
      for (let i = 0; i < mask.data.length; i += 4) if (mask.data[i]! < 128 === ink) n++;
      return n;
    };
    const holeCount = 18 * 18; // 6..57 at a 3 px pitch, each 1 px
    const paperAround = SIZE * SIZE - 56 * 56;
    const presets = ['Smooth', 'Line Art', 'Sharp'] as const;
    for (const name of presets) {
      const preset = TRACE_PRESETS[name]!;
      for (const options of [preset, { ...preset, medianFilter: false }] as TraceOptions[]) {
        const keep = name === 'Sharp';
        expect(count(prepareContourTraceInput(dots, options).prepared, true), name).toBe(
          keep ? 19 * 19 : 0,
        );
        expect(count(prepareContourTraceInput(holes, options).prepared, false), name).toBe(
          paperAround + (keep ? holeCount : 0),
        );
      }
    }
  });

  it('leaves a forced median and non-median presets on their existing order', () => {
    const noisy = withSpecks(artwork(), specks());
    for (const options of [
      { ...MEDIAN_ONLY, medianFilter: true },
      TRACE_PRESETS['Line Art']!,
      TRACE_PRESETS['Centerline']!,
    ] as TraceOptions[]) {
      const enlarged = prepareUpscaledTraceInput(noisy, options, 2);
      expect(enlarged.image.data).toEqual(upscaleBy(noisy, 2).data);
      expect(enlarged.options.medianFilter).toBe(options.medianFilter);
    }
  });

  it('traces a small noisy source like its clean original with the Smooth preset', async () => {
    // 60 px: the small-source policy supersamples 3x. Salt inside solid ink
    // is not ink, so despeckle never sees it; only the median removes it.
    const clean = paper(60);
    for (let y = 10; y < 50; y += 1) for (let x = 10; x < 50; x += 1) paint(clean, x, y, 0);
    const noisy = copy(clean);
    for (let y = 13; y < 48; y += 4) for (let x = 13; x < 48; x += 4) paint(noisy, x, y, 255);
    const traced = await traceImageToColoredPaths(noisy, SMOOTH);
    expect(traced).toEqual(await traceImageToColoredPaths(clean, SMOOTH));
  });
});

function rows(image: RawImageData, spans: ReadonlyArray<readonly [number, number, number]>): void {
  for (const [y, x0, x1] of spans) for (let x = x0; x < x1; x += 1) paint(image, x, y, 0);
}

function cols(image: RawImageData, spans: ReadonlyArray<readonly [number, number, number]>): void {
  for (const [x, y0, y1] of spans) for (let y = y0; y < y1; y += 1) paint(image, x, y, 0);
}

function diagonal(image: RawImageData, x0: number, y0: number, length: number): void {
  for (let k = 0; k < length; k += 1) paint(image, x0 + k, y0 + k, 0);
}

function antiDiagonal(image: RawImageData, x0: number, y0: number, length: number): void {
  for (let k = 0; k < length; k += 1) paint(image, x0 - k, y0 + k, 0);
}

/** One-pixel lines with `cell` px of paper between them, from (x0, y0). */
function grid(image: RawImageData, x0: number, y0: number, span: number, pitch: number): void {
  for (let y = y0; y < y0 + span - 2; y += 1) {
    for (let x = x0; x < x0 + span - 2; x += 1) {
      if ((x - x0) % pitch === 0 || (y - y0) % pitch === 0) paint(image, x, y, 0);
    }
  }
}

/** A speck at least three pixels from any drawn feature, so the feature's
 * own support search and the speck's never meet. */
function farFromInk(image: RawImageData, speck: Speck): boolean {
  if (!speck.ink) return true;
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const x = speck.x + dx;
      const y = speck.y + dy;
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      if ((image.data[(y * image.width + x) * 4] ?? 255) < 128) return false;
    }
  }
  return true;
}

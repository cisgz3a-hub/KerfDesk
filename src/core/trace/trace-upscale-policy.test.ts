import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { upscaleBy } from './auto-upscale';
import { TRACE_PRESETS } from './trace-presets';
import type { RawImageData, TraceOptions } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';
import { traceScalePlan, traceUpscaleFactor } from './trace-upscale-policy';

const LINE_ART = TRACE_PRESETS['Line Art']!;

function whiteImage(width: number, height: number): RawImageData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

function paintRect(
  image: RawImageData,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = 0;
      image.data[offset + 1] = 0;
      image.data[offset + 2] = 0;
      image.data[offset + 3] = 255;
    }
  }
}

function thickLogo(width = 512, height = 512): RawImageData {
  const image = whiteImage(width, height);
  paintRect(image, Math.floor(width / 8), Math.floor(height / 5), Math.floor(width * 0.75), 24);
  paintRect(image, Math.floor(width / 8), Math.floor(height / 5), 24, Math.floor(height * 0.6));
  paintRect(
    image,
    Math.floor(width / 8),
    Math.floor(height * 0.8) - 24,
    Math.floor(width * 0.75),
    24,
  );
  return image;
}

function colorfulPicture(width: number, height: number, cellSize = 8): RawImageData {
  const image = whiteImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dark = (Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 0;
      const offset = (y * width + x) * 4;
      image.data[offset] = dark ? 20 : 240;
      image.data[offset + 1] = dark ? 80 : 180;
      image.data[offset + 2] = dark ? 180 : 40;
    }
  }
  return image;
}

describe('traceUpscaleFactor', () => {
  it('does not force 2x work for mid-size thick line art', () => {
    expect(traceUpscaleFactor(thickLogo(), LINE_ART)).toBe(1);
  });

  it('retains the 2x quality path for mixed-width art', () => {
    const image = thickLogo();
    paintRect(image, 430, 160, 2, 80);
    expect(traceUpscaleFactor(image, LINE_ART)).toBe(2);
  });

  it('honours an explicit supersample opt-out', () => {
    const image = thickLogo();
    paintRect(image, 430, 160, 2, 80);
    const options: TraceOptions = { ...LINE_ART, supersampleContour: false };
    expect(traceUpscaleFactor(image, options)).toBe(1);
  });

  it('preserves the historical small-source quality trigger', () => {
    const image = whiteImage(60, 60);
    paintRect(image, 16, 12, 8, 36);
    expect(traceUpscaleFactor(image, LINE_ART)).toBe(3);
  });

  it('refuses optional 2x work beyond the contour working-pixel budget', () => {
    const image = whiteImage(1600, 1000);
    paintRect(image, 200, 200, 2, 100);
    expect(traceUpscaleFactor(image, LINE_ART)).toBe(1);
  });

  it('keeps a dense mid-size color picture at native resolution', () => {
    expect(traceScalePlan(colorfulPicture(800, 600), LINE_ART)).toEqual({ kind: 'native' });
  });

  it('downscales a large dense color picture to a bounded working grid', () => {
    const plan = traceScalePlan(colorfulPicture(1600, 1000), LINE_ART);
    expect(plan.kind).toBe('downscale');
    if (plan.kind !== 'downscale') return;
    expect(plan.width * plan.height).toBeLessThanOrEqual(1_260_000);
    expect(plan.coordinateScale).toBeGreaterThan(1);
  });
});

describe('trace supersample performance regression', () => {
  it('traces a thick 512px logo materially faster than the old forced-2x route', async () => {
    const image = thickLogo();
    const oldForcedOptions: TraceOptions = {
      ...LINE_ART,
      supersampleContour: false,
      autoUpscaleSmallSources: false,
      upscaleSmallSmoothSources: false,
      pixelScale: 2,
    };

    await traceImageToColoredPaths(thickLogo(64, 64), {
      ...LINE_ART,
      supersampleContour: false,
    });

    const nativeStart = performance.now();
    await traceImageToColoredPaths(image, LINE_ART);
    const nativeMs = performance.now() - nativeStart;

    const forcedStart = performance.now();
    await traceImageToColoredPaths(upscaleBy(image, 2), oldForcedOptions);
    const forcedMs = performance.now() - forcedStart;

    expect(nativeMs).toBeLessThan(forcedMs * 0.8);
  }, 30_000);

  it('traces a dense color picture materially faster than the old forced-2x route', async () => {
    const image = colorfulPicture(600, 450);
    const oldForcedOptions: TraceOptions = {
      ...LINE_ART,
      supersampleContour: false,
      autoUpscaleSmallSources: false,
      upscaleSmallSmoothSources: false,
      pixelScale: 2,
    };

    const nativeStart = performance.now();
    await traceImageToColoredPaths(image, LINE_ART);
    const nativeMs = performance.now() - nativeStart;

    const forcedStart = performance.now();
    await traceImageToColoredPaths(upscaleBy(image, 2), oldForcedOptions);
    const forcedMs = performance.now() - forcedStart;

    expect(nativeMs).toBeLessThan(forcedMs * 0.6);
  }, 30_000);
});

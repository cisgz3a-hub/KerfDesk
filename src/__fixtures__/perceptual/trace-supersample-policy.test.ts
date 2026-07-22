import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { downscaleTracedPaths, upscaleBy } from '../../core/trace/auto-upscale';
import { TRACE_PRESETS } from '../../core/trace/trace-presets';
import type { RawImageData, TraceOptions } from '../../core/trace/trace-image';
import { traceImageToColoredPaths } from '../../core/trace/trace-to-paths';
import { traceUpscaleFactor } from '../../core/trace/trace-upscale-policy';
import { compareMasks } from './compare';
import { decodePngFile } from './png-decode';
import { writePerceptualArtifact } from './png';
import { rasterizeColoredPaths } from './rasterize';

const LINE_ART = TRACE_PRESETS['Line Art']!;

const SOURCE_PATH = join(
  process.cwd(),
  'src',
  '__fixtures__',
  'perceptual',
  'assets',
  'arch-house-langebaan-source.png',
);

describe('trace supersample policy acceptance fixture', () => {
  it('retains the quality supersample for the arch-house thin-detail fixture', () => {
    const source = decodePngFile(SOURCE_PATH);
    expect(traceUpscaleFactor(source, LINE_ART)).toBe(2);
  });

  it('keeps native thick-art output perceptually aligned with the former forced-2x route', async () => {
    const source = thickLogo();
    const nativePaths = await traceImageToColoredPaths(source, LINE_ART);
    const forcedOptions: TraceOptions = {
      ...LINE_ART,
      supersampleContour: false,
      autoUpscaleSmallSources: false,
      upscaleSmallSmoothSources: false,
      pixelScale: 2,
    };
    const forcedPaths = downscaleTracedPaths(
      await traceImageToColoredPaths(upscaleBy(source, 2), forcedOptions),
      2,
    );
    const nativeMask = rasterizeColoredPaths(nativePaths, source.width, source.height);
    const forcedMask = rasterizeColoredPaths(forcedPaths, source.width, source.height);

    writePerceptualArtifact('trace-thick-logo-native-vs-forced-2x', nativeMask, forcedMask);
    expect(compareMasks(nativeMask, forcedMask).iou).toBeGreaterThanOrEqual(0.97);
  });
});

function thickLogo(): RawImageData {
  const width = 512;
  const height = 512;
  const image: RawImageData = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4).fill(255),
  };
  paintRect(image, 64, 102, 384, 24);
  paintRect(image, 64, 102, 24, 308);
  paintRect(image, 64, 386, 384, 24);
  return image;
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

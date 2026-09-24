// compile-job-raster-stream — builds the streamed (row-at-a-time) S-value
// providers for raster groups. Streaming holds O(width) state instead of
// materializing width*height luma + dither buffers, which is what lets any
// size of image engrave compile without a memory refusal (ADR-243):
//
//   source luma rows -> burn-grid resample -> mask -> machine orient -> dither
//
// Independent dithers (threshold / ordered / grayscale) compute each row in
// isolation. Error-diffusion dithers use the sequential 3-row window ditherer
// (dither-rows.ts), which is bit-identical to the materialized dither().

import type { DeviceProfile } from '../devices';
import { burnGridKernel, createLumaRowResampler } from '../raster/luma-resample';
import type { RasterPowerValues } from '../raster/raster-power-values';
import { createImageMaskPixelTest } from '../raster/image-mask';
import { ditherIndependentRow, isErrorDiffusionMode } from '../raster/dither';
import { createErrorDiffusionRowDitherer } from '../raster/dither-rows';
import { originFlipsRasterX, originFlipsRasterY } from '../raster-output';
import type { Layer, RasterImage, SceneObject } from '../scene';
import type { RasterMachineBounds } from './raster-bounds';
import { isRotatedRaster, prepareRotatedRaster, rotatedRasterRow } from './raster-rotated-sample';

const WHITE_LUMA_BYTE = 255;

export type StreamedRasterInput = {
  readonly sourceLuma: Uint8Array;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly obj: RasterImage;
  readonly maskObject: SceneObject | null;
  readonly device: DeviceProfile;
  readonly bounds: RasterMachineBounds;
  readonly algorithm: Layer['ditherAlgorithm'];
  readonly passThrough?: boolean;
  readonly sMax: number;
  readonly sMin: number;
};

/**
 * Row provider for a streamed raster group: `(y) => RasterPowerValues` of S values
 * for the machine-oriented target row y. Byte-identical to the materialized
 * pipeline for every dither algorithm — the axis-aligned
 * resample→mask→orient path for unrotated images, the inverse-transform
 * sampler for rotated ones (masked at source resolution, matching
 * rotatedMaskedRasterLuma).
 */
export function streamedRasterRowProvider(
  input: StreamedRasterInput,
): (y: number) => RasterPowerValues {
  const lumaRowAt = streamedLumaRowAt(input);
  if (isErrorDiffusionMode(input.algorithm)) {
    return createErrorDiffusionRowDitherer({
      width: input.pixelWidth,
      height: input.pixelHeight,
      algorithm: input.algorithm,
      sMax: input.sMax,
      lumaRowAt,
    });
  }
  const algorithm = input.algorithm;
  return (y: number): RasterPowerValues =>
    ditherIndependentRow(lumaRowAt(y), y, {
      algorithm,
      sMax: input.sMax,
      sMin: input.sMin,
    });
}

function streamedLumaRowAt(input: StreamedRasterInput): (y: number) => Uint8Array {
  if (isRotatedRaster(input.obj)) {
    // Masked (and, for the area kernel, reduced) once per provider, exactly
    // as the materialized rotatedMaskedRasterLuma prepares it.
    const prepared = prepareRotatedRaster(
      {
        sourceLuma: input.sourceLuma,
        obj: input.obj,
        device: input.device,
        bounds: input.bounds,
        pixelWidth: input.pixelWidth,
        pixelHeight: input.pixelHeight,
        kernel: burnGridKernel(input.algorithm),
        passThrough: input.passThrough === true,
      },
      input.maskObject,
    );
    return (y: number): Uint8Array => rotatedRasterRow(prepared, y);
  }
  const objFlipX = input.obj.transform.mirrorX !== input.obj.transform.scaleX < 0;
  const objFlipY = input.obj.transform.mirrorY !== input.obj.transform.scaleY < 0;
  const flipX = originFlipsRasterX(input.device) !== objFlipX;
  const flipY = originFlipsRasterY(input.device) !== objFlipY;
  // Contours are transformed once here; the per-row loop only runs the
  // point-in-polygon test.
  const insideMask = createImageMaskPixelTest(
    input.obj,
    input.maskObject,
    input.pixelWidth,
    input.pixelHeight,
  );
  const resampledRowAt = createLumaRowResampler(
    { luma: input.sourceLuma, width: input.sourceWidth, height: input.sourceHeight },
    input.pixelWidth,
    input.pixelHeight,
    burnGridKernel(input.algorithm),
  );
  return (y: number): Uint8Array =>
    resampledOrientedRow(input, y, { flipX, flipY, insideMask, resampledRowAt });
}

type OrientedRowOptions = {
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly insideMask: ((x: number, y: number) => boolean) | null;
  readonly resampledRowAt: (targetY: number) => Uint8Array;
};

// The mask tests the PRE-orientation target grid — the same grid the
// materialized path masks before orienting — so (targetX, targetY) is
// computed before the machine flips are applied to the output index.
function resampledOrientedRow(
  input: StreamedRasterInput,
  y: number,
  options: OrientedRowOptions,
): Uint8Array {
  const { flipX, flipY, insideMask } = options;
  const targetY = flipY ? input.pixelHeight - 1 - y : y;
  const resampled = options.resampledRowAt(targetY);
  const row = new Uint8Array(input.pixelWidth);
  for (let x = 0; x < input.pixelWidth; x += 1) {
    const targetX = flipX ? input.pixelWidth - 1 - x : x;
    row[x] =
      insideMask !== null && !insideMask(targetX, targetY)
        ? WHITE_LUMA_BYTE
        : (resampled[targetX] ?? WHITE_LUMA_BYTE);
  }
  return row;
}

// Trace-from-camera (ADR-110, camera v4): capture the aligned camera view,
// warp it top-down into bed millimetre space, and hand it to the existing
// trace pipeline as a RasterImage whose bounds ARE the bed — so the traced
// vectors land at the object's true machine coordinates.

import {
  frameMatchesCalibration,
  rectifyImage,
  scaleIntrinsicsToFrame,
  warpFrameToBed,
  type CameraAlignment,
  type CameraCalibration,
  type RgbaImage,
} from '../../core/camera';
import { DEFAULT_RASTER_LAYER_COLOR, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { extractLumaBase64 } from '../trace/image-loader';

// 4 px/mm ≈ 102 dpi: plenty for outline tracing without a huge warp buffer.
export const TRACE_PIXELS_PER_MM = 4;

export type CameraTraceFailure =
  | 'no-alignment'
  | 'basis-mismatch'
  | 'warp-failed'
  | 'encode-failed';

export type CameraTraceResult =
  | { readonly kind: 'ok'; readonly source: RasterImage }
  | { readonly kind: 'failed'; readonly reason: CameraTraceFailure };

/**
 * Build the bed-registered RasterImage for the trace dialog from a raw camera
 * frame. The frame is de-fisheyed first when the ALIGNMENT lives in the
 * rectified basis (a rectified alignment must never warp raw pixels, and vice
 * versa — mixing bases silently mis-registers).
 */
export function buildCameraTraceImage(args: {
  readonly raw: RgbaImage;
  readonly alignment: CameraAlignment | undefined;
  readonly calibration: CameraCalibration | undefined;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
}): CameraTraceResult {
  const { raw, alignment, calibration } = args;
  if (alignment === undefined) return { kind: 'failed', reason: 'no-alignment' };
  let frame = raw;
  if (alignment.basis === 'rectified') {
    if (calibration === undefined) return { kind: 'failed', reason: 'basis-mismatch' };
    const sourceK = frameMatchesCalibration(calibration, raw.width, raw.height)
      ? calibration.intrinsics
      : scaleIntrinsicsToFrame(calibration, raw.width, raw.height);
    frame = rectifyImage(raw, {
      width: raw.width,
      height: raw.height,
      outputK: sourceK,
      sourceK,
      distortion: calibration.distortion,
    });
  }
  const warped = warpFrameToBed(frame, {
    bedWidthMm: args.bedWidthMm,
    bedHeightMm: args.bedHeightMm,
    pixelsPerMm: TRACE_PIXELS_PER_MM,
    homography: alignment.homography,
  });
  if (warped.kind !== 'ok') return { kind: 'failed', reason: 'warp-failed' };
  const dataUrl = rgbaToPngDataUrl(warped.image);
  if (dataUrl === null) return { kind: 'failed', reason: 'encode-failed' };
  return {
    kind: 'ok',
    source: {
      kind: 'raster-image',
      id: crypto.randomUUID(),
      source: 'camera capture',
      dataUrl,
      pixelWidth: warped.image.width,
      pixelHeight: warped.image.height,
      bounds: { minX: 0, minY: 0, maxX: args.bedWidthMm, maxY: args.bedHeightMm },
      transform: IDENTITY_TRANSFORM,
      color: DEFAULT_RASTER_LAYER_COLOR,
      dither: 'floyd-steinberg',
      linesPerMm: 10,
      lumaBase64: extractLumaBase64({
        data: warped.image.data,
        width: warped.image.width,
        height: warped.image.height,
      }),
    },
  };
}

// Synchronous PNG encode via a throwaway canvas; null when the 2D context or
// PNG encoder is unavailable (device-memory backed, or jsdom) so callers
// surface a typed failure instead of an uncaught "Not implemented" throw.
function rgbaToPngDataUrl(image: RgbaImage): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

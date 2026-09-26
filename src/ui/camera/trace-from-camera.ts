// Trace-from-camera (ADR-110, ADR-440): flatten a camera frame onto the bed
// at the material's surface height with the saved camera model, and hand it
// to the existing trace pipeline as a RasterImage whose bounds ARE the bed,
// so the traced vectors land at the object's true machine coordinates.

import { warpFrameToBedImage } from '../../core/camera/model/bed-image';
import type { CameraPose, LensModel } from '../../core/camera/model/camera-model';
import type { RgbaImage } from '../../core/camera/rgba-image';
import { DEFAULT_RASTER_LAYER_COLOR, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { rgbaToPngDataUrl } from './png-encode';
import { extractLumaBase64 } from '../trace/image-loader';

// 4 px/mm ≈ 102 dpi: plenty for outline tracing without a huge warp buffer.
export const TRACE_PIXELS_PER_MM = 4;

export type CameraTraceFailure = 'warp-failed' | 'encode-failed';

export type CameraTraceResult =
  | { readonly kind: 'ok'; readonly source: RasterImage }
  | { readonly kind: 'failed'; readonly reason: CameraTraceFailure };

/** The bed-registered RasterImage for the trace dialog from a raw camera frame. */
export function buildCameraTraceImage(args: {
  readonly raw: RgbaImage;
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  readonly surfaceHeightMm: number;
}): CameraTraceResult {
  const image = warpFrameToBedImage(args.raw, args.lens, args.pose, {
    bedWidthMm: args.bedWidthMm,
    bedHeightMm: args.bedHeightMm,
    pixelsPerMm: TRACE_PIXELS_PER_MM,
    surfaceHeightMm: args.surfaceHeightMm,
  });
  if (image === null) return { kind: 'failed', reason: 'warp-failed' };
  const dataUrl = rgbaToPngDataUrl(image);
  if (dataUrl === null) return { kind: 'failed', reason: 'encode-failed' };
  return {
    kind: 'ok',
    source: {
      kind: 'raster-image',
      id: crypto.randomUUID(),
      source: 'camera capture',
      dataUrl,
      pixelWidth: image.width,
      pixelHeight: image.height,
      bounds: { minX: 0, minY: 0, maxX: args.bedWidthMm, maxY: args.bedHeightMm },
      transform: IDENTITY_TRANSFORM,
      color: DEFAULT_RASTER_LAYER_COLOR,
      dither: 'floyd-steinberg',
      linesPerMm: 10,
      lumaBase64: extractLumaBase64({ data: image.data, width: image.width, height: image.height }),
    },
  };
}

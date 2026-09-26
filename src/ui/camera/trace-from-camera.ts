// Trace-from-camera (ADR-110, ADR-440): flatten a camera frame onto the bed
// with the saved camera model, at the material height and at each height
// area's own height (ADR-441 Amendment 2), and hand it to the existing trace
// pipeline as a RasterImage whose bounds ARE the pictured part of the bed, so
// the traced vectors land at the object's true machine coordinates.

import { warpFrameToBedImage } from '../../core/camera/model/bed-image';
import type { BedArea } from '../../core/camera/model/camera-model-accuracy';
import type { CameraPose, LensModel } from '../../core/camera/model/camera-model';
import type { SurfaceHeightArea } from '../../core/camera/model/height-areas';
import type { RgbaImage } from '../../core/camera/rgba-image';
import { DEFAULT_RASTER_LAYER_COLOR, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { rgbaToPngDataUrl } from './png-encode';
import { extractLumaBase64 } from '../trace/image-loader';

// 4 px/mm ≈ 102 dpi: plenty for outline tracing without a huge warp buffer.
export const TRACE_PIXELS_PER_MM = 4;
// Tracing one area pictures far less of the bed, so it can afford twice the
// density for smoother outlines, as long as the picture stays within budget.
export const AREA_TRACE_PIXELS_PER_MM = 8;
const AREA_TRACE_PIXEL_BUDGET = 12_000_000;

export type CameraTraceFailure = 'warp-failed' | 'encode-failed';

export type CameraTraceResult =
  | { readonly kind: 'ok'; readonly source: RasterImage }
  | { readonly kind: 'failed'; readonly reason: CameraTraceFailure };

/** Pixel density for tracing `region`: the whole bed keeps TRACE_PIXELS_PER_MM. */
export function tracePixelsPerMm(region: BedArea | null): number {
  if (region === null) return TRACE_PIXELS_PER_MM;
  const areaMm2 = region.width * region.height;
  if (!(areaMm2 > 0)) return AREA_TRACE_PIXELS_PER_MM;
  const withinBudget = Math.sqrt(AREA_TRACE_PIXEL_BUDGET / areaMm2);
  return Math.max(TRACE_PIXELS_PER_MM, Math.min(AREA_TRACE_PIXELS_PER_MM, withinBudget));
}

/** The bed-registered RasterImage for the trace dialog from a raw camera frame. */
export function buildCameraTraceImage(args: {
  readonly raw: RgbaImage;
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  readonly surfaceHeightMm: number;
  readonly heightAreas: ReadonlyArray<SurfaceHeightArea>;
  /** Trace only this part of the bed; null traces the whole bed. */
  readonly region: BedArea | null;
}): CameraTraceResult {
  const region = args.region ?? { x: 0, y: 0, width: args.bedWidthMm, height: args.bedHeightMm };
  const image = warpFrameToBedImage(args.raw, args.lens, args.pose, {
    region,
    pixelsPerMm: tracePixelsPerMm(args.region),
    surfaceHeightMm: args.surfaceHeightMm,
    heightAreas: args.heightAreas,
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
      bounds: {
        minX: region.x,
        minY: region.y,
        maxX: region.x + region.width,
        maxY: region.y + region.height,
      },
      transform: IDENTITY_TRANSFORM,
      color: DEFAULT_RASTER_LAYER_COLOR,
      dither: 'floyd-steinberg',
      linesPerMm: 10,
      lumaBase64: extractLumaBase64({ data: image.data, width: image.width, height: image.height }),
    },
  };
}

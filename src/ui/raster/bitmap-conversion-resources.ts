import {
  MAX_RASTER_WORKING_BYTES,
  type RasterBudgetVerdict,
} from '../../core/raster/raster-budget';
import type { ColoredPath } from '../../core/scene';

// Conversion materializes luma, RGBA/ImageData, a canvas, PNG and base64
// encodings. The generic dither budget's eight bytes/pixel cannot cover this.
// Reserve headroom for those overlapping representations, plus cloned source
// geometry and the bounded flattened geometry used by the scanline rasterizer.
const ENCODING_BYTES_PER_PIXEL = 32;
const SOURCE_GEOMETRY_BYTES_PER_UNIT = 256;
const GEOMETRY_CONTAINER_BYTES = 128;
const FLATTENED_SEGMENT_BYTES = 128;

export type BitmapGeometryResources = {
  readonly sourceBytes: number;
  readonly minimumFlattenedSegments: number;
};

export function estimateBitmapGeometryResources(
  objects: ReadonlyArray<{ readonly paths: ReadonlyArray<ColoredPath> }>,
): BitmapGeometryResources {
  let sourceBytes = objects.length * GEOMETRY_CONTAINER_BYTES;
  let minimumFlattenedSegments = 0;
  for (const object of objects) {
    for (const path of object.paths) {
      sourceBytes += GEOMETRY_CONTAINER_BYTES;
      for (const polyline of path.polylines) {
        sourceBytes +=
          GEOMETRY_CONTAINER_BYTES + polyline.points.length * SOURCE_GEOMETRY_BYTES_PER_UNIT;
        if (path.curves === undefined) minimumFlattenedSegments += polyline.points.length;
      }
      for (const curve of path.curves ?? []) {
        sourceBytes +=
          GEOMETRY_CONTAINER_BYTES + (curve.segments.length + 1) * SOURCE_GEOMETRY_BYTES_PER_UNIT;
        minimumFlattenedSegments += curve.segments.length;
      }
    }
  }
  return { sourceBytes, minimumFlattenedSegments };
}

export function bitmapConversionResources(
  pixelWidth: number,
  pixelHeight: number,
  geometry: BitmapGeometryResources = { sourceBytes: 0, minimumFlattenedSegments: 0 },
): { readonly verdict: RasterBudgetVerdict; readonly maxFlattenedSegments: number } {
  const valid =
    Number.isSafeInteger(pixelWidth) &&
    Number.isSafeInteger(pixelHeight) &&
    pixelWidth > 0 &&
    pixelHeight > 0;
  const pixelCount = valid ? pixelWidth * pixelHeight : 0;
  const baseBytes = pixelCount * ENCODING_BYTES_PER_PIXEL + geometry.sourceBytes;
  const estimatedWorkingBytes =
    baseBytes + geometry.minimumFlattenedSegments * FLATTENED_SEGMENT_BYTES;
  const budget = {
    pixelWidth,
    pixelHeight,
    pixelCount,
    workUnits: pixelCount,
    mode: 'materialized' as const,
    estimatedWorkingBytes,
  };
  const maxFlattenedSegments = Math.max(
    0,
    Math.floor((MAX_RASTER_WORKING_BYTES - baseBytes) / FLATTENED_SEGMENT_BYTES),
  );
  const reason = !valid
    ? 'invalid raster pixel dimensions'
    : `bitmap encoding and geometry need about ${Math.ceil(estimatedWorkingBytes / 1048576)} MB, above the ${MAX_RASTER_WORKING_BYTES / 1048576} MB conversion budget`;
  return {
    maxFlattenedSegments,
    verdict:
      valid &&
      Number.isFinite(estimatedWorkingBytes) &&
      estimatedWorkingBytes <= MAX_RASTER_WORKING_BYTES
        ? { kind: 'ok', budget }
        : { kind: 'too-large', budget, reason },
  };
}

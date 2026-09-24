import { MAX_RASTER_WORKING_BYTES } from '../../core/raster/raster-budget';
import {
  validatePackedPhotoPolylines,
  type PackedPhotoPolylines,
} from '../../core/raster/rasterize-photo-coverage';
import { applyTransform, type ColoredPath, type TracedImage, type Vec2 } from '../../core/scene';
import type { BitmapGeometryResources } from './bitmap-conversion-resources';

// Transferred points (16), indexed pixel edges (32), order/active/crossing
// arrays (16), and sorting scratch/headroom (16), per original vertex.
const WORKING_BYTES_PER_POINT = 80;
const PACKED_METADATA_BYTES = 4096;

export function packedPhotoBitmapResources(
  geometry: PackedPhotoPolylines,
): BitmapGeometryResources {
  validatePackedPhotoPolylines(geometry);
  return {
    sourceBytes:
      (geometry.points.length / 2) * WORKING_BYTES_PER_POINT +
      geometry.offsets.byteLength * 2 +
      PACKED_METADATA_BYTES,
    minimumFlattenedSegments: 0,
    scanlineBytesPerPixel: 8,
  };
}

/** Only the single even-odd, closed, straight-edge photo representation opts
 * in. Canonical curves take precedence; other artwork keeps generic assembly. */
export function packPhotoBitmapGeometry(source: TracedImage): PackedPhotoPolylines | undefined {
  const path = source.paths[0];
  if (source.paths.length !== 1 || path === undefined || path.fillRule === 'nonzero')
    return undefined;
  const sizes = photoContourSizes(path);
  if (sizes === undefined) return undefined;
  const count = sizes.reduce((sum, size) => sum + size, 0);
  if (sizes.some((size) => size < 3) || count * WORKING_BYTES_PER_POINT > MAX_RASTER_WORKING_BYTES)
    return undefined;
  const points = new Float64Array(count * 2);
  const offsets = new Uint32Array(sizes.length + 1);
  let pointIndex = 0;
  const append = (point: Vec2): void => {
    const scene = applyTransform(point, source.transform);
    if (!Number.isFinite(scene.x) || !Number.isFinite(scene.y))
      throw new Error('Invalid photo contour coordinate.');
    points[pointIndex * 2] = scene.x;
    points[pointIndex * 2 + 1] = scene.y;
    pointIndex += 1;
  };
  if (path.curves === undefined) {
    path.polylines.forEach((line, index) => {
      line.points.forEach(append);
      offsets[index + 1] = pointIndex;
    });
  } else {
    path.curves.forEach((curve, index) => {
      append(curve.start);
      curve.segments.forEach((segment) => append(segment.to));
      offsets[index + 1] = pointIndex;
    });
  }
  return { points, offsets };
}

function photoContourSizes(path: ColoredPath): number[] | undefined {
  const contours = path.curves ?? path.polylines;
  if (contours.length === 0 || contours.some((contour) => !contour.closed)) return undefined;
  if (path.curves?.some((curve) => curve.segments.some((segment) => segment.kind !== 'line')))
    return undefined;
  return path.curves === undefined
    ? path.polylines.map((line) => line.points.length)
    : path.curves.map((curve) => curve.segments.length + 1);
}

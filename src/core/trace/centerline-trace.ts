import type { ColoredPath } from '../scene';
import { squaredDistanceToBackground } from './centerline-distance';
import { centerlineMaskFromImage, thinMask } from './centerline-mask';
import { extractCenterlinePolylines } from './centerline-polylines';
import { preprocessForTrace, type RawImageData, type TraceOptions } from './trace-image';

const INK_COLOR = '#000000';

export function traceImageToCenterlinePaths(
  image: RawImageData,
  options: TraceOptions,
): ColoredPath[] {
  const prepared = preprocessForTrace(image, options);
  // preprocessForTrace already applies manual threshold bands, Otsu, alpha
  // masks, and despeckle. The mask sees that prepared binary image here; passing
  // the same band again would reject black pixels when cutoffLuma > 0.
  const sourceMask = centerlineMaskFromImage(prepared);
  const skeletonMask = thinMask(sourceMask, prepared.width, prepared.height);
  const distanceSq = squaredDistanceToBackground(sourceMask, prepared.width, prepared.height);
  const polylines = extractCenterlinePolylines(skeletonMask, prepared.width, prepared.height, {
    distanceSq,
    simplifyTolerancePx: options.lineTolerance,
  });
  return polylines.length === 0 ? [] : [{ color: INK_COLOR, polylines }];
}

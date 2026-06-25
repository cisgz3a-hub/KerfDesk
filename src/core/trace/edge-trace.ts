// Edge Detection trace (ADR-059): Canny edge map -> single-stroke vectors. The
// clean-room Canny detector produces a 1px edge map of every brightness
// transition, then the ADR-058 centerline extraction traces each edge as ONE
// smooth polyline (not a doubled outline) -- the correct laser semantics for a
// line drawing. Turns full-colour art into engraving-ready line-art of its
// edges, where the filled-contours modes would give only a flat silhouette.

import type { ColoredPath } from '../scene';
import { cannyEdges } from './canny-edges';
import { extractCenterlinePolylines } from './centerline-polylines';
import type { RawImageData, TraceOptions } from './trace-image';

const EDGE_COLOR = '#000000';

export function traceImageToEdgePaths(image: RawImageData, options: TraceOptions): ColoredPath[] {
  const edges = cannyEdges(image);
  const polylines = extractCenterlinePolylines(edges, image.width, image.height, {
    simplifyTolerancePx: options.lineTolerance,
  });
  return polylines.length === 0 ? [] : [{ color: EDGE_COLOR, polylines }];
}

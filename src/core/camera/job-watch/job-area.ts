// The part of the bed a camera watches during a job (ADR-490): the job's own
// bounds plus a margin, kept on the bed, pictured at a density that keeps the
// picture within a pixel budget. The margin also keeps every burn clear of the
// picture's edge, so a change that touches the edge is known not to be the
// burn (the gantry, a hand, the material moving). Pure core.

import type { BedArea } from '../model/camera-model-accuracy';
import type { Vec2 } from '../model/camera-model';

export const JOB_WATCH_MARGIN_MM = 10;

/** The job's bounds grown by `marginMm`, clipped to the bed; null when nothing is left. */
export function jobWatchRegion(
  points: ReadonlyArray<Vec2>,
  bed: { readonly width: number; readonly height: number },
  marginMm: number = JOB_WATCH_MARGIN_MM,
): BedArea | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!(maxX >= minX && maxY >= minY)) return null;
  const x0 = Math.max(0, minX - marginMm);
  const y0 = Math.max(0, minY - marginMm);
  const x1 = Math.min(bed.width, maxX + marginMm);
  const y1 = Math.min(bed.height, maxY + marginMm);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * The density to picture `region` at: `maxPixelsPerMm`, lowered until the
 * longer side fits `maxSidePx` and the whole picture fits `maxPixels`.
 */
export function watchPixelsPerMm(
  region: BedArea,
  limits: {
    readonly maxPixelsPerMm: number;
    readonly maxSidePx: number;
    readonly maxPixels: number;
  },
): number {
  const side = Math.max(region.width, region.height);
  const area = region.width * region.height;
  if (!(side > 0 && area > 0)) return limits.maxPixelsPerMm;
  return Math.min(
    limits.maxPixelsPerMm,
    limits.maxSidePx / side,
    Math.sqrt(limits.maxPixels / area),
  );
}

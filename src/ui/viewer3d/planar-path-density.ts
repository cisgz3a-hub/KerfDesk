// Dense flat engraving paths need thin strokes and a recessive travel overlay.
// Measure geometry once; zoom only changes opacity, never moves.
import { SEG_KIND } from '../../core/gcode-view';
import type { Viewer3dSegmentsInput } from './segment-buckets';

export type PlanarPathDensity = {
  /** Travel per XY area (1/mm), or zero when a flat path has no area to measure. */
  readonly travelPerMm: number;
};

const PLANAR_TOLERANCE_MM = 0.001;
// Keep the total tint weak when several travel strokes cover each pixel.
const COVERAGE_FACTOR = 6;

export function planarPathDensity(segments: Viewer3dSegmentsInput): PlanarPathDensity | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let travelMm = 0;
  for (let index = 0; index < segments.segmentCount; index += 1) {
    const base = index * 6;
    const x0 = segments.positions[base] ?? 0;
    const y0 = segments.positions[base + 1] ?? 0;
    const z0 = segments.positions[base + 2] ?? 0;
    const x1 = segments.positions[base + 3] ?? 0;
    const y1 = segments.positions[base + 4] ?? 0;
    const z1 = segments.positions[base + 5] ?? 0;
    minZ = Math.min(minZ, z0, z1);
    maxZ = Math.max(maxZ, z0, z1);
    if (maxZ - minZ > PLANAR_TOLERANCE_MM) return null;
    minX = Math.min(minX, x0, x1);
    maxX = Math.max(maxX, x0, x1);
    minY = Math.min(minY, y0, y1);
    maxY = Math.max(maxY, y0, y1);
    if (visibleTravel(segments, index)) {
      travelMm += Math.hypot(x1 - x0, y1 - y0);
    }
  }
  const area = (maxX - minX) * (maxY - minY);
  if (![minX, maxX, minY, maxY, minZ, maxZ, area].every(Number.isFinite)) return null;
  // Zero XY area does not imply depth changes: an axis-aligned retrace is flat.
  // Keep its ordered strokes without applying an undefined area-based travel tint.
  return { travelPerMm: area > 0 ? travelMm / area : 0 };
}

function visibleTravel(segments: Viewer3dSegmentsInput, index: number): boolean {
  return segments.segKind[index] === SEG_KIND.travel && segments.visible?.[index] !== 0;
}

/** XY coverage grows as the camera sees the plane at a shallower angle. */
export function planarViewScale(
  mmPerPixel: number,
  orientation: { readonly x: number; readonly y: number },
): number {
  // Z component of the camera's unit Z axis, rotated by its quaternion.
  const facing = Math.abs(1 - 2 * (orientation.x ** 2 + orientation.y ** 2));
  return mmPerPixel / Math.max(0.01, facing);
}

/** Restore the normal travel opacity as zoom resolves individual moves. */
export function planarTravelOpacity(
  density: PlanarPathDensity | null,
  mmPerPixel: number,
  opacity: number,
): number {
  if (density === null || !Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return opacity;
  const coverage = density.travelPerMm * mmPerPixel;
  return opacity / Math.max(1, coverage * COVERAGE_FACTOR);
}

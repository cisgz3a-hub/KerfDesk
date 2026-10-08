// Chord error for the round corners and round caps of the two user-facing
// offset tools: Offset Shapes (ADR-410) and the properties-panel offset
// (ADR-103). Clipper's own default is a fifth of a percent of the offset
// distance, which is finer than the machine curve tolerance for small offsets
// and far coarser for large ones (0.1 mm at 50 mm, 2 mm at 1 m). The chords
// are stored and cut as they are, so they must not drift off the circle by more
// than the tolerance every other curve in the app is held to (ADR-410
// amendment 1). Only these tools pass it; Clipper's default is left alone for
// every other caller.

import { DEFAULT_MACHINE_CURVE_TOLERANCE_MM } from '../scene/curve-path';
import { VECTOR_PATH_PRECISION_DECIMALS } from './vector-path-regions';

// Clipper's default arc tolerance: the offset distance divided by 500.
const CLIPPER_DEFAULT_ARC_RATIO = 0.002;
// Clipper rounds every vertex to the 1 µm grid, which can move a chord's
// midpoint by up to about 0.7 µm; one grid step is kept back from the budget
// so the stored chords, not just the exact ones, stay within it.
const GRID_STEP_MM = 10 ** -VECTOR_PATH_PRECISION_DECIMALS;

export const OFFSET_ARC_TOLERANCE_CAP_MM = DEFAULT_MACHINE_CURVE_TOLERANCE_MM - GRID_STEP_MM;

/**
 * The arc tolerance (the widest a chord may sit inside its circle, in mm) for a
 * round join or cap at this offset distance: Clipper's own fine default, capped
 * so a big offset never chords coarser than the machine curve tolerance.
 * Offsets up to about 12 mm are therefore unchanged.
 */
export function offsetArcToleranceMm(distanceMm: number): number {
  if (!Number.isFinite(distanceMm)) return OFFSET_ARC_TOLERANCE_CAP_MM;
  return Math.min(Math.abs(distanceMm) * CLIPPER_DEFAULT_ARC_RATIO, OFFSET_ARC_TOLERANCE_CAP_MM);
}

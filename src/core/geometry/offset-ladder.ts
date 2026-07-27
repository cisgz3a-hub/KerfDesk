// buildOffsetLadder — the repeated inward-offset loop every CNC "offset
// ladder" walks: pocket rings, the v-carve ring ladder and relief waterline
// rings all offset the SAME source contours by a growing inset until an
// offset yields nothing.
//
// The loop lives here rather than in each caller because the REASON it
// stopped matters and is easy to get wrong. clipper2 can fail on pathological
// geometry, and a failed offset yields no contours — exactly what "the region
// ran out of interior" yields. Conflating the two truncates a CNC toolpath
// silently: the pocket looks finished, and a later pass meets stock it
// believed was cleared. The ladder keeps the failure so the diagnostics scan
// can warn about it. Advisory only — nothing here refuses anything (rule 7).

import { offsetClosedPolylinesForKerfChecked } from './kerf-offset';
import type { Polyline } from '../scene';

export type OffsetLadder = {
  // One entry per step that produced contours, in step order. The step that
  // ended the ladder produced none and is not included.
  readonly rings: ReadonlyArray<ReadonlyArray<Polyline>>;
  // True when the ladder stopped because the offset ENGINE failed rather than
  // because the region ran out of interior: the toolpath is truncated and
  // material the ladder should have cleared is still standing.
  readonly offsetFailed: boolean;
};

export type InsetContours = {
  readonly contours: ReadonlyArray<Polyline>;
  readonly offsetFailed: boolean;
};

/**
 * Offset `contours` inward by `insetMmForStep(step)` for step 0, 1, 2 … until
 * a step yields no contours, the offset engine fails, or `maxSteps` is
 * reached. Insets are positive distances inward.
 */
export function buildOffsetLadder(
  contours: ReadonlyArray<Polyline>,
  maxSteps: number,
  insetMmForStep: (step: number) => number,
): OffsetLadder {
  const rings: Array<ReadonlyArray<Polyline>> = [];
  for (let step = 0; step < maxSteps; step += 1) {
    const offset = offsetClosedPolylinesForKerfChecked(contours, -insetMmForStep(step));
    if (offset.kind === 'error') return { rings, offsetFailed: true };
    if (offset.value.length === 0) return { rings, offsetFailed: false };
    rings.push(offset.value);
  }
  return { rings, offsetFailed: false };
}

/**
 * One inward offset, drawing the same failure-vs-empty distinction the ladder
 * draws. For the single insets that GATE a ladder (a raster pocket's wall, the
 * v-carve clearance floor), where an empty result ends the operation just as
 * silently as an empty ring ends a ladder.
 */
export function insetContoursChecked(
  contours: ReadonlyArray<Polyline>,
  insetMm: number,
): InsetContours {
  const offset = offsetClosedPolylinesForKerfChecked(contours, -insetMm);
  return offset.kind === 'error'
    ? { contours: [], offsetFailed: true }
    : { contours: offset.value, offsetFailed: false };
}

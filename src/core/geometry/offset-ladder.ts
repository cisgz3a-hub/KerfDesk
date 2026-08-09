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
  // True when the ladder ran out of BUDGET (maxSteps) while the last step
  // still produced contours: interior remains that no ring visited. Silent
  // before the #584 audit made the case reachable from valid UI settings —
  // callers report it as a pass-limit advisory, never a refusal (rule 7).
  readonly capped: boolean;
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
    if (offset.kind === 'error') return { rings, offsetFailed: true, capped: false };
    if (offset.value.length === 0) return { rings, offsetFailed: false, capped: false };
    rings.push(offset.value);
  }
  // One non-emitting lookahead distinguishes "the last allowed ring was also
  // the natural final ring" from "usable interior remains beyond the budget."
  // Without it, merely filling the last slot produced a false pass-limit
  // warning even when the very next inset was empty.
  const lookahead = offsetClosedPolylinesForKerfChecked(contours, -insetMmForStep(maxSteps));
  if (lookahead.kind === 'error') return { rings, offsetFailed: true, capped: false };
  return { rings, offsetFailed: false, capped: lookahead.value.length > 0 };
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

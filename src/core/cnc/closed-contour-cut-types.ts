// Which cut types produce nothing at all from open contours.
//
// Measured against the compiler, not assumed: with a layer holding only open
// polylines, v-carve, pocket and drill each emit ZERO motion, while
// profile-outside, profile-inside, profile-on-path and engrave all still emit.
// The three below need an enclosed region — the V-carve planner keeps only
// closed source contours, the pocket clearer offsets inward from a boundary,
// and drill takes the centre of a closed shape — so an open stroke gives them
// nothing to work with and the layer silently contributes no toolpath.
//
// The rule lives here rather than inside each operation so the design-time
// note in the layers panel and the compiler cannot drift apart, the same
// reason vcarve-carvable-contours.ts exists.
//
// This is a fact about output, not a policy: nothing here blocks, gates or
// refuses a cut type. It exists so the operator can be TOLD (rule 7).

import type { CncCutType } from '../scene';

const CUT_TYPES_NEEDING_CLOSED_CONTOURS: ReadonlySet<CncCutType> = new Set<CncCutType>([
  'v-carve',
  'pocket',
  'drill',
]);

/** True when this cut type emits no motion at all unless a contour is closed. */
export function cutTypeNeedsClosedContours(cutType: CncCutType): boolean {
  return CUT_TYPES_NEEDING_CLOSED_CONTOURS.has(cutType);
}

// Which layer-card field sets the ramp angle relief roughing reads
// (`rampEntryDeg`, ADR-424): the Ramp entry row under Entry & travel on a
// profile, pocket or engrave layer, and the relief rows' Roughing ramp on any
// other layer. A V-carve layer's Ramp entry sets its own V-bit angle, and drill
// and inlay layers show no Ramp entry row.
//
// The rule lives here so the layer card and the Job Review notice that names
// the field cannot drift apart, the same reason closed-contour-cut-types.ts
// exists.

import type { CncCutType } from '../scene';

/** Cut types whose Ramp entry row (in Entry & travel) edits the ramp angle
 * relief roughing reads; a V-carve layer's row sets its own V-bit angle. */
export function cutTypeShowsRampEntry(cutType: CncCutType): boolean {
  return cutType.startsWith('profile') || cutType === 'pocket' || cutType === 'engrave';
}

/** The field a layer of this cut type sets its relief roughing ramp in. */
export function reliefRampFieldLabel(cutType: CncCutType): 'Ramp entry' | 'Roughing ramp' {
  return cutTypeShowsRampEntry(cutType) ? 'Ramp entry' : 'Roughing ramp';
}

// vcarveAxisTail - drive the last v-carve ring onto the medial axis.
//
// The δ ladder (vcarve-ladder.ts) offsets inward by δ, 2δ, 3δ … and stops at
// the first inset that yields nothing. That stopping rule is what leaves a
// standing ridge down the middle of every stroke:
//
//   A ring at inset d cuts every point within distance d of the boundary to
//   its EXACT analytic depth - the bit's cone flank and the V-groove wall have
//   the same slope, so the flank sweeps the true wall rather than approximating
//   it. A point is therefore under-cut if and only if its distance to the
//   boundary exceeds the deepest inset any ring reached. That set is precisely
//   the interior of the final ring - the material around the medial axis.
//
// So the whole defect is the δ quantisation of where the ladder stops. If the
// ladder's last ring is at `lo` and `lo + δ` produced nothing, the largest
// inradius R is trapped in [lo, lo + δ): some region still has interior at lo,
// none has any at lo + δ. Bisect that bracket. Every midpoint that still yields
// contours IS a real, deeper ring carrying the same proven depth law; every
// midpoint that yields nothing tightens the upper bound. K halvings leave a
// residual ridge of δ / (2^K · tan(θ/2)), so the ridge falls geometrically for
// a handful of extra offset calls rather than the thousands of extra rings a
// uniformly finer δ would cost across the whole ladder.
//
// Termination is a fact about the output, not a tuning knob: once the bracket
// is narrower than the emitter's coordinate quantum, a further ring is the same
// path at emit precision and carries no new material.
//
// Pure and deterministic: insets are a fixed bisection sequence over the input
// bracket, no clock, no random. Advisory-compatible (rule 7) - an engine
// failure is reported, never a refusal, and the coarse rings already emitted
// remain valid on their own.

import { offsetClosedPolylinesForKerfChecked } from '../geometry/kerf-offset';
import type { Polyline } from '../scene';

// The emitter formats coordinates at 3 decimals (cnc-grbl-emit-head.ts).
// A bracket tighter than one quantum cannot produce a distinguishable ring.
const EMIT_COORDINATE_QUANTUM_MM = 0.001;

// 10 halvings take the default auto pitch (tool/8 = 0.75 mm for a 6 mm bit)
// to 0.0007 mm of residual bracket - already under the emission quantum, so
// the quantum check below is what normally stops it. This is the runaway
// backstop, in the spirit of MAX_VCARVE_RINGS.
const MAX_AXIS_TAIL_STEPS = 10;

// The offset engine rounds to a 0.001 mm grid (OFFSET_PRECISION_DECIMALS = 3),
// so "this inset produced contours" only certifies that the true distance to
// the boundary is within one grid quantum of it - NOT that it reaches it. The
// δ ladder never had to care: its insets are coarse multiples of δ, far from
// the rounding boundary. A bisection deliberately walks up to the medial axis
// until it is inside the grid, so it meets the rounding every time.
//
// Measured: a 0.2085 mm band (true half-width 0.10425) kept contours at an
// inset of 0.1044921875 - 0.24 µm past the real inradius. Cutting that inset
// as a depth gouges by the same amount.
//
// So report a CERTIFIED inset: one quantum shallower than the inset that
// survived, which the survival itself guarantees is real geometry. The cost is
// 1 µm of depth, three orders under the ridge this module removes, and it is
// the same conservative-shallow shift emissionSafetyMarginMm applies for the
// analogous XYZ formatting rounding (vcarve-detail-depth.ts).
const OFFSET_GRID_QUANTUM_MM = 0.001;

/** One refined ring, carrying its own inset because the tail is no longer on
 *  the ladder's uniform δ grid. Depth stays the caller's law: inset / tan(θ/2),
 *  clamped to the carve's maximum depth. */
export type AxisTailRing = {
  readonly insetMm: number;
  readonly polylines: ReadonlyArray<Polyline>;
};

export type AxisTail = {
  // Strictly increasing inset order - shallow to deep, matching the ladder.
  readonly rings: ReadonlyArray<AxisTailRing>;
  // The offset engine failed mid-bisection: the tail is shorter than the
  // geometry allows and a ridge remains. Reported to Job Review, never a
  // refusal (rule 7). Rings found before the failure are still returned.
  readonly offsetFailed: boolean;
};

const NO_TAIL: AxisTail = { rings: [], offsetFailed: false };

/**
 * Refine the gap between the ladder's deepest surviving inset and the first
 * inset that produced nothing, so the deepest ring lands within one emission
 * quantum of the medial axis.
 *
 * @param contours Same source contours the δ ladder offset - already normalized.
 * @param lastInsetMm Deepest inset that produced rings. 0 when the ladder
 *   produced none at all, in which case the bracket opens at the boundary.
 * @param failedInsetMm First inset that produced nothing. Must exceed
 *   `lastInsetMm`; the medial axis lies in [lastInsetMm, failedInsetMm).
 */
export function vcarveAxisTail(
  contours: ReadonlyArray<Polyline>,
  lastInsetMm: number,
  failedInsetMm: number,
): AxisTail {
  if (!isUsableBracket(lastInsetMm, failedInsetMm) || contours.length === 0) return NO_TAIL;
  // Only the DEEPEST probe becomes toolpath. The shallower ones are search
  // steps: a ring at inset m cuts every point within distance m of the boundary
  // to its exact depth, so the deepest ring subsumes all of them. Emitting the
  // whole bisection would add ~10 nested rings per region that differ by
  // micrometres in depth and cut nothing the last one misses.
  let deepest: AxisTailRing | null = null;
  let lo = lastInsetMm;
  let hi = failedInsetMm;
  for (let step = 0; step < MAX_AXIS_TAIL_STEPS; step += 1) {
    if (hi - lo <= EMIT_COORDINATE_QUANTUM_MM) break;
    const mid = lo + (hi - lo) / 2;
    // Guard against a midpoint that rounds onto an endpoint in floating point:
    // the bracket would stop shrinking and the loop would spin out its budget.
    if (mid <= lo || mid >= hi) break;
    const offset = offsetClosedPolylinesForKerfChecked(contours, -mid);
    if (offset.kind === 'error') return { rings: tailRings(deepest), offsetFailed: true };
    if (offset.value.length === 0) {
      hi = mid;
      continue;
    }
    const certifiedInsetMm = mid - OFFSET_GRID_QUANTUM_MM;
    // A certified inset at or below the ladder's own floor carries no depth the
    // δ rings have not already cut, so it would only add travel.
    if (certifiedInsetMm > lastInsetMm) {
      deepest = { insetMm: certifiedInsetMm, polylines: offset.value };
    }
    lo = mid;
  }
  return { rings: tailRings(deepest), offsetFailed: false };
}

function tailRings(deepest: AxisTailRing | null): ReadonlyArray<AxisTailRing> {
  return deepest === null ? [] : [deepest];
}

// A bracket is only meaningful when both ends are finite, non-negative and
// ordered. Anything else means the caller had no ladder to refine.
function isUsableBracket(lastInsetMm: number, failedInsetMm: number): boolean {
  return (
    Number.isFinite(lastInsetMm) &&
    Number.isFinite(failedInsetMm) &&
    lastInsetMm >= 0 &&
    failedInsetMm > lastInsetMm
  );
}

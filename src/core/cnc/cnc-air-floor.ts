// CNC air floors (ADR-489): where a pass may be rapided down to instead of
// fed down from safe Z.
//
// A pass's `airFloorZMm` is a claim its producer proves from the job's own
// earlier cuts: with its tip at or above that Z, the cutter touches no stock
// anywhere along the pass's path. The emitter then rapids down to the floor
// plus this clearance and feeds the rest of the plunge, and the post-emit
// motion check accepts a rapid below safe Z only in that shape.

/** Height above a pass's air floor where its rapid descent stops and the
 *  plunge feed takes over. Covers Z touch-off and stock-model rounding; one
 *  millimetre costs a fraction of a second of plunge feed per entry. */
export const CNC_AIR_RAPID_CLEARANCE_MM = 1;

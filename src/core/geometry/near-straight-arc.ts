// An arc whose sagitta (its greatest distance from its chord) is below this
// fraction of the chord is a straight line (ADR-159 Amendment 3). Converting
// such an arc through its centre puts that centre about chord / (8 x ratio)
// away: at a DXF bulge of 1e-17 that is 1e17 mm, where double rounding moves
// the cubic's control points by tens of millimetres (rolling audit v11
// W5-P1-1). At this ratio the centre is at most ~1.25e8 chords away, so
// rounding stays below 3e-8 of the chord, and the straight line it replaces
// is within 1e-9 of the chord (1 nm on a 1 m edge).
export const NEAR_STRAIGHT_SAGITTA_PER_CHORD = 1e-9;

/**
 * A DXF bulge is tan(sweep / 4) and its sagitta is exactly |bulge| x chord / 2,
 * so the test needs no chord length.
 */
export function isNearStraightBulge(bulge: number): boolean {
  return Math.abs(bulge) / 2 <= NEAR_STRAIGHT_SAGITTA_PER_CHORD;
}

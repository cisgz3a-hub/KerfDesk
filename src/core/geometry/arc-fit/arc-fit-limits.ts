// Limits for fitting line and circular-arc moves to laser output (ADR-432).
//
// The deviation budget splits the machine curve tolerance
// (DEFAULT_MACHINE_CURVE_TOLERANCE_MM, 0.025 mm) that compile's G1 chords
// already honour, so what the controller executes never lands farther from the
// canonical curve than the chord it replaces:
//   source  0.001 mm  sampled source chords against the true curve
//   emit    0.002 mm  3-decimal X/Y/I/J words: the centre is written relative to
//                     the already-rounded start, so it moves at most
//                     0.0005*sqrt(2) mm and the radius at most twice that
//   control  s mm     GRBL executes an arc as max(1, floor(|0.5 travel r| /
//                     sqrt($12 (2r - $12)))) equal chords (mc_arc,
//                     grbl/motion_control.c, gnea/grbl master); s is their sag
//                     at the stock $12 of 0.002 mm (DEFAULT_ARC_TOLERANCE,
//                     grbl/defaults.h). Because the count rounds down, s runs
//                     from about 0.002 mm on long arcs up to 0.008 mm on an arc
//                     just short of two chords; zero for a line
//   fit     the rest  the fitted line/arc against the sampled source, both ways
// Sum: 0.025 mm.

/** Stock GRBL `$12` arc tolerance, mm (DEFAULT_ARC_TOLERANCE, grbl/defaults.h). */
export const GRBL_STOCK_ARC_TOLERANCE_MM = 0.002;

/** What 3-decimal X/Y/I/J words can move an emitted arc, mm. */
export const ARC_FIT_EMIT_ROUNDING_MM = 0.002;

/** Largest chord error of the sampled source against its true curve, mm. */
export const ARC_FIT_SOURCE_SAMPLE_ERROR_MM = 0.001;

/** Largest spacing between candidate break points along a smooth run, mm. */
export const ARC_FIT_BREAK_SPACING_MM = 0.5;

/**
 * Smallest arc radius, mm. Below it one 3-decimal I/J quantum (0.0005 mm) is
 * more than 0.5% of the radius, and the arc is smaller than a typical diode
 * spot (about 0.08 x 0.1 mm or larger), so a chord or two says the same thing.
 * GRBL itself tolerates small arcs: it rejects only a start/end radius mismatch
 * above 0.005 mm that is also above 0.1% of the radius (gcode.c, gnea/grbl
 * master), which 3-decimal rounding cannot reach (at most about 0.0028 mm).
 */
export const ARC_FIT_MIN_RADIUS_MM = 0.1;

/**
 * Largest arc radius, mm. GRBL computes arcs in 32-bit floats. With a bed up to
 * about 1 m, a centre within 1 m of the work keeps every coordinate below
 * 2048 mm, where float32 spacing is at most 2^-13 mm (0.00012 mm), below the
 * 0.001 mm emitted resolution. A flatter arc is emitted as a line whenever the
 * line fits, which it does for any chord under sqrt(8 x 1000 x 0.02) = 12.6 mm.
 */
export const ARC_FIT_MAX_RADIUS_MM = 1000;

/**
 * Largest sweep of one arc, radians (179 degrees). Keeping every arc inside a
 * half turn keeps its sector convex, which makes the deviation check exact
 * (see arc-piece-check.ts), and keeps GRBL far from its full-circle ambiguity:
 * mc_arc adds a full turn when the offset form's angular travel falls within
 * ARC_ANGULAR_TRAVEL_EPSILON (5e-7 rad, grbl/config.h) of zero in the wrong
 * direction. A full circle is emitted as two arcs.
 */
export const ARC_FIT_MAX_SWEEP_RAD = (179 * Math.PI) / 180;

/**
 * Joints between curve pieces whose tangents turn by no more than this are
 * smooth, so a biarc may run through them. Anything sharper is a corner and
 * stays a vertex at its exact position.
 */
export const ARC_FIT_SMOOTH_JOINT_DEG = 1;

/**
 * Inside a smooth run, a single arc may meet the source tangent at either end
 * off by at most this much, so two moves meet at a smooth source point with a
 * turn of at most twice it. Biarcs meet the source tangent exactly; a plain
 * chord is used only where it covers more of the run per move than any arc.
 */
export const ARC_FIT_MAX_KINK_DEG = 2;

/**
 * Inside a smooth run, a straight chord must arrive within this angle of the
 * source tangent, and every move must leave the one before it with a turn
 * under ARC_FIT_CORNER_DEG. Arriving close to the tangent leaves the next move
 * (an arc within the kink, another chord, or the source's own sample chord)
 * room to meet it under the corner angle. Without these a chord bridging a
 * feature too tight for an arc (radius under ARC_FIT_MIN_RADIUS_MM) made a
 * sharp joint where the source curve had none.
 */
export const ARC_FIT_MAX_CHORD_TANGENT_DEG = 29;

/**
 * Straight-segment runs break at vertices turning at least this much: the
 * tree-wide hard-corner convention (ADR-391's laser trace simplification, the
 * CNC fairing and the tracer's corner detection all pin 60 degrees).
 */
export const ARC_FIT_CORNER_DEG = 60;

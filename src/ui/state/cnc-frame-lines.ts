// cnc-frame-lines — assembles the CNC framing motion: a Z-safe retract, the XY
// perimeter, then a restore back to the pre-frame Z so the bit ends where it
// started instead of parked at safe height (ADR-192, fixes the "frame lifts the
// bit even after Zero Z" report).
//
// ADR-094: this module never hardcodes protocol bytes — it only ORDERS lines
// produced by the driver seam (the XY perimeter and the absolute-Z jog builder).
//
// The retract/restore is gated on a current work-Z zero. The retract targets the
// WORK frame (`Z<safeZ>`); without an established Z0 that height is an arbitrary
// physical position and the jog could drive the bit into the stock, so a frame
// with no current Z evidence falls back to the XY-only perimeter — the historical
// laser-mode behavior and no worse than pre-retract framing.

// Below this |Δ mm| the pre-frame Z already equals safe Z, so the restore jog is
// redundant and omitted.
const FRAME_Z_RESTORE_EPSILON_MM = 1e-3;

export function buildCncFrameMotion(input: {
  /** The driver's Z-silent XY perimeter jogs. */
  readonly perimeter: ReadonlyArray<string>;
  /** Configured clearance above the stock top (work Z). */
  readonly safeZMm: number;
  /** Bit's work Z before framing, restored afterward. Null when unknowable. */
  readonly preFrameWorkZMm: number | null;
  /** Whether a current-session work-Z zero is established. */
  readonly hasCurrentWorkZEvidence: boolean;
  /** Driver builder for an absolute `$J=` Z jog; undefined on drivers without one. */
  readonly buildRetract: ((zMm: number, feed: number) => string) | undefined;
  readonly feed: number;
}): ReadonlyArray<string> {
  if (!input.hasCurrentWorkZEvidence || input.buildRetract === undefined) {
    return input.perimeter;
  }
  const retract = input.buildRetract(input.safeZMm, input.feed);
  const restore = frameZRestoreLine(
    input.preFrameWorkZMm,
    input.safeZMm,
    input.feed,
    input.buildRetract,
  );
  return restore === undefined
    ? [retract, ...input.perimeter]
    : [retract, ...input.perimeter, restore];
}

// The restore is the same absolute-Z jog shape as the retract, aimed back at the
// pre-frame height. Omitted when that height is unknown (leave the bit at safe Z
// rather than jog to a guessed position) or already equal to safe Z.
function frameZRestoreLine(
  preFrameWorkZMm: number | null,
  safeZMm: number,
  feed: number,
  buildRetract: (zMm: number, feed: number) => string,
): string | undefined {
  if (preFrameWorkZMm === null) return undefined;
  if (Math.abs(preFrameWorkZMm - safeZMm) < FRAME_Z_RESTORE_EPSILON_MM) return undefined;
  return buildRetract(preFrameWorkZMm, feed);
}

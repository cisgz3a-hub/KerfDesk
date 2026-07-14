// cnc-frame-lines — assembles the CNC framing motion: a Z-safe retract, the XY
// perimeter, then a restore back to the pre-frame Z so the bit ends where it
// started instead of parked at safe height (ADR-192, fixes the "frame lifts the
// bit even after Zero Z" report).
//
// ADR-094: this module never hardcodes protocol bytes — it only ORDERS lines
// produced by the driver seam (the XY perimeter and the absolute-Z jog builder).
//
// The retract/restore is gated on a current work-Z zero. The retract targets the
// WORK frame (`Z<safeZ>`); without an established Z0 that height is arbitrary,
// while an XY-only fallback could drag the bit through stock. Both cases block.

// Below this |Δ mm| the pre-frame Z already equals safe Z, so the restore jog is
// redundant and omitted.
const FRAME_Z_RESTORE_EPSILON_MM = 1e-3;

export const CNC_FRAME_WORK_Z_REQUIRED_MESSAGE =
  'CNC Frame requires a current work Z zero so the bit can retract above the stock before XY motion. Zero Z or run a settled probe, then Frame again.';
export const CNC_FRAME_RETRACT_UNSUPPORTED_MESSAGE =
  'CNC Frame is unavailable because this controller cannot build the required safe-Z retract.';

export type CncFrameMotionPlan =
  | { readonly kind: 'ready'; readonly lines: ReadonlyArray<string> }
  | { readonly kind: 'blocked'; readonly message: string };

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
}): CncFrameMotionPlan {
  if (!input.hasCurrentWorkZEvidence) {
    return { kind: 'blocked', message: CNC_FRAME_WORK_Z_REQUIRED_MESSAGE };
  }
  if (input.buildRetract === undefined) {
    return { kind: 'blocked', message: CNC_FRAME_RETRACT_UNSUPPORTED_MESSAGE };
  }
  const retract = input.buildRetract(input.safeZMm, input.feed);
  const restore = frameZRestoreLine(
    input.preFrameWorkZMm,
    input.safeZMm,
    input.feed,
    input.buildRetract,
  );
  const lines =
    restore === undefined ? [retract, ...input.perimeter] : [retract, ...input.perimeter, restore];
  return { kind: 'ready', lines };
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

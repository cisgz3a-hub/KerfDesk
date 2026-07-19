// cnc-frame-lines — assembles the CNC framing motion: a Z-safe retract, the XY
// perimeter, then a restore back to a nonnegative pre-frame Z so the bit ends
// where it started instead of parked at safe height. A bit that started below
// the stock-top zero remains retracted after Frame (ADR-192).
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
export const CNC_FRAME_POSITION_REQUIRED_MESSAGE =
  'CNC Frame needs a fresh controller position so it can return the bit to its exact starting Z. Wait for an Idle position report, then Frame again.';

export type CncFrameMotionPlan =
  | { readonly kind: 'ready'; readonly lines: ReadonlyArray<string> }
  | { readonly kind: 'blocked'; readonly message: string };

export function buildCncFrameMotion(input: {
  /** The driver's Z-silent XY perimeter jogs. */
  readonly perimeter: ReadonlyArray<string>;
  /** Optional absolute work-XY return, run while still retracted. */
  readonly returnLine?: string;
  /** Configured clearance above the stock top (work Z). */
  readonly safeZMm: number;
  /** Bit's work Z before framing; nonnegative values are restored afterward. */
  readonly preFrameWorkZMm: number | null;
  /** Whether a current-session work-Z zero is established. */
  readonly hasCurrentWorkZEvidence: boolean;
  /** Driver builder for an absolute `$J=` Z jog; undefined on drivers without one. */
  readonly buildRetract: ((zMm: number, feed: number) => string) | undefined;
  readonly zFeed: number;
}): CncFrameMotionPlan {
  if (!input.hasCurrentWorkZEvidence) {
    return { kind: 'blocked', message: CNC_FRAME_WORK_Z_REQUIRED_MESSAGE };
  }
  if (input.preFrameWorkZMm === null) {
    return { kind: 'blocked', message: CNC_FRAME_POSITION_REQUIRED_MESSAGE };
  }
  if (input.buildRetract === undefined) {
    return { kind: 'blocked', message: CNC_FRAME_RETRACT_UNSUPPORTED_MESSAGE };
  }
  const retract = input.buildRetract(input.safeZMm, input.zFeed);
  const restore = frameZRestoreLine(
    input.preFrameWorkZMm,
    input.safeZMm,
    input.zFeed,
    input.buildRetract,
  );
  const xyMoves =
    input.returnLine === undefined ? input.perimeter : [...input.perimeter, input.returnLine];
  const lines = restore === undefined ? [retract, ...xyMoves] : [retract, ...xyMoves, restore];
  return { kind: 'ready', lines };
}

// The restore is the same absolute-Z jog shape as the retract, aimed back at the
// pre-frame height. Unknown height is rejected before this helper; omission is
// valid only when the bit already equals the configured safe Z.
function frameZRestoreLine(
  preFrameWorkZMm: number,
  safeZMm: number,
  feed: number,
  buildRetract: (zMm: number, feed: number) => string,
): string | undefined {
  // A negative work Z is inside the stock contract. Frame proves the XY
  // envelope tool-off; it must not finish by plunging the bit back into stock.
  if (preFrameWorkZMm < 0) return undefined;
  if (Math.abs(preFrameWorkZMm - safeZMm) < FRAME_Z_RESTORE_EPSILON_MM) return undefined;
  return buildRetract(preFrameWorkZMm, feed);
}

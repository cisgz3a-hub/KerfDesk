// cnc-frame-lines — assembles the CNC framing motion: a Z-safe retract, the XY
// perimeter, then a restore back to a nonnegative pre-frame Z so the bit ends
// where it started instead of parked at safe height. A bit that started below
// the stock-top zero remains retracted after Frame (ADR-192). A bit already at
// or above safe Z traces at its own height: the retract is an absolute Z jog,
// so from there it would lower the bit (ADR-192 Amendment 1).
//
// ADR-094: this module never hardcodes protocol bytes — it only ORDERS lines
// produced by the driver seam (the XY perimeter and the absolute-Z jog builder).
//
// The retract/restore is gated on a current work-Z zero. The retract targets the
// WORK frame (`Z<safeZ>`); without an established Z0 that height is arbitrary,
// while an XY-only fallback could drag the bit through stock. Both cases block.

// Within this many mm of safe Z the bit already sits at safe height.
const SAFE_Z_EPSILON_MM = 1e-3;

/** True when the bit already clears the configured safe height, so the
 * absolute safe-Z jog would lower it (after a probe park, into the plate still
 * under the bit) instead of raising it. */
export function isAtOrAboveSafeZ(workZMm: number, safeZMm: number): boolean {
  return workZMm >= safeZMm - SAFE_Z_EPSILON_MM;
}

// Checked before anything else (controller audit CN-2): on a controller that
// cannot run KerfDesk CNC jobs (Marlin, Smoothieware) no CNC Frame can be built,
// so the operator is not first sent to zero Z for it. The same fact Start
// states as CNC_REQUIRES_GRBL_MESSAGE.
export const CNC_FRAME_REQUIRES_GRBL_MESSAGE =
  'CNC Frame is unavailable: KerfDesk CNC jobs require a GRBL-family controller (GRBL, grblHAL, FluidNC), and the connected controller cannot run them. Connect a GRBL-family controller, or switch the project to Laser mode.';
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
  /** The connected driver's `capabilities.cncJobs`. */
  readonly cncJobsSupported: boolean;
}): CncFrameMotionPlan {
  if (!input.cncJobsSupported) {
    return { kind: 'blocked', message: CNC_FRAME_REQUIRES_GRBL_MESSAGE };
  }
  if (!input.hasCurrentWorkZEvidence) {
    return { kind: 'blocked', message: CNC_FRAME_WORK_Z_REQUIRED_MESSAGE };
  }
  if (input.preFrameWorkZMm === null) {
    return { kind: 'blocked', message: CNC_FRAME_POSITION_REQUIRED_MESSAGE };
  }
  if (input.buildRetract === undefined) {
    return { kind: 'blocked', message: CNC_FRAME_RETRACT_UNSUPPORTED_MESSAGE };
  }
  const xyMoves =
    input.returnLine === undefined ? input.perimeter : [...input.perimeter, input.returnLine];
  if (isAtOrAboveSafeZ(input.preFrameWorkZMm, input.safeZMm)) {
    return { kind: 'ready', lines: xyMoves };
  }
  const retract = input.buildRetract(input.safeZMm, input.zFeed);
  // A negative work Z is inside the stock contract. Frame proves the XY
  // envelope tool-off; it must not finish by plunging the bit back into stock.
  if (input.preFrameWorkZMm < 0) return { kind: 'ready', lines: [retract, ...xyMoves] };
  // The restore is the same absolute-Z jog shape, aimed back at the pre-frame
  // height, which is below safe Z here.
  const restore = input.buildRetract(input.preFrameWorkZMm, input.zFeed);
  return { kind: 'ready', lines: [retract, ...xyMoves, restore] };
}

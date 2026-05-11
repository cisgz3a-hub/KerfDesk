/**
 * T1-178 (external audit High #4): numeric validation at the
 * controller-operations boundary.
 *
 * Pre-T1-178 `GrblController.operations.jog` / `testFire` / `frame`
 * accepted raw numbers from callers without validating them at the
 * boundary. The audit flagged this as High severity because the
 * controller is the last layer before bytes hit the wire — any UI
 * bypass (a future code path, a direct service call, a test harness
 * holding a `GrblControllerApi` reference) could send
 * `powerPercent=500`, `distanceMm=9999`, `feedMmPerMin=Infinity`, or
 * `maxSpindle=NaN` and produce dangerous machine motion.
 *
 * Defense-in-depth design: the UI may still clamp upstream, but the
 * controller refuses to compose a G-code line from invalid numbers.
 * The validators throw `InvalidOperationArgumentError` carrying the
 * field name + offending value so support bundles can capture which
 * call site produced the bad number.
 *
 * Bounds rationale:
 *   - `MAX_JOG_DISTANCE_MM = 10000` (10 m) — larger than any
 *     supported laser bed. A jog farther than this is a UI bug.
 *   - `MAX_FEED_MM_PER_MIN = 100000` — covers the fastest stepper
 *     setups with headroom. Beyond this is implausible.
 *   - `MAX_SPINDLE = 100000` — bounds the GRBL $30 PWM ceiling.
 *     Real-world values are 255 or 1000, but we allow headroom.
 *
 * The bounds are deliberately loose; they exist to catch garbage
 * (NaN, Infinity, negative-where-positive-required, type confusion)
 * not to enforce machine-specific limits (which `MachinePreflight`
 * already does at compile time).
 */

export const MAX_JOG_DISTANCE_MM = 10000;
export const MAX_FEED_MM_PER_MIN = 100000;
export const MAX_SPINDLE_VALUE = 100000;

/**
 * Thrown when a controller-operation argument fails validation at
 * the controller boundary. Carries `field` + `value` so the call
 * site can be traced from a support log.
 */
export class InvalidOperationArgumentError extends Error {
  readonly field: string;
  readonly value: unknown;
  constructor(field: string, value: unknown, reason: string) {
    super(`Invalid ${field}: ${reason} (got ${String(value)}).`);
    this.name = 'InvalidOperationArgumentError';
    this.field = field;
    this.value = value;
  }
}

/**
 * Check `value` is a finite number. Rejects NaN, Infinity, non-
 * numeric input.
 */
function assertFinite(field: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidOperationArgumentError(field, value, 'must be a finite number');
  }
}

function assertFiniteInRange(
  field: string,
  value: unknown,
  min: number,
  max: number,
): asserts value is number {
  assertFinite(field, value);
  if ((value as number) < min || (value as number) > max) {
    throw new InvalidOperationArgumentError(
      field, value, `must be in [${min}, ${max}]`,
    );
  }
}

/** Validate jog args. Axis must be one of X / Y / Z; distance + feed must be finite + bounded. */
export function validateJogArgs(args: {
  axis: 'X' | 'Y' | 'Z';
  distanceMm: number;
  feedMmPerMin: number;
}): void {
  if (args.axis !== 'X' && args.axis !== 'Y' && args.axis !== 'Z') {
    throw new InvalidOperationArgumentError('axis', args.axis, 'must be one of X, Y, Z');
  }
  // Distance is signed (jog -10mm is legal — backward jog), so the
  // bound is absolute-value.
  assertFinite('distanceMm', args.distanceMm);
  if (Math.abs(args.distanceMm) > MAX_JOG_DISTANCE_MM) {
    throw new InvalidOperationArgumentError(
      'distanceMm', args.distanceMm,
      `absolute value must be <= ${MAX_JOG_DISTANCE_MM}`,
    );
  }
  // Feed must be strictly positive.
  assertFinite('feedMmPerMin', args.feedMmPerMin);
  if (args.feedMmPerMin <= 0 || args.feedMmPerMin > MAX_FEED_MM_PER_MIN) {
    throw new InvalidOperationArgumentError(
      'feedMmPerMin', args.feedMmPerMin,
      `must be in (0, ${MAX_FEED_MM_PER_MIN}]`,
    );
  }
}

/** Validate test-fire args. powerPercent must be in [0, 100]; maxSpindle must be positive. */
export function validateTestFireArgs(args: {
  powerPercent: number;
  maxSpindle: number;
}): void {
  assertFiniteInRange('powerPercent', args.powerPercent, 0, 100);
  assertFinite('maxSpindle', args.maxSpindle);
  if (args.maxSpindle <= 0 || args.maxSpindle > MAX_SPINDLE_VALUE) {
    throw new InvalidOperationArgumentError(
      'maxSpindle', args.maxSpindle,
      `must be in (0, ${MAX_SPINDLE_VALUE}]`,
    );
  }
}

/** Validate frame args. corners non-empty + finite XY; maxSpindle positive; feed (if set) positive. */
export function validateFrameArgs(args: {
  corners: readonly { x: number; y: number }[];
  maxSpindle: number;
  frameDotFeedRateMmPerMin?: number;
}): void {
  if (!Array.isArray(args.corners) || args.corners.length === 0) {
    throw new InvalidOperationArgumentError(
      'corners', args.corners, 'must be a non-empty array of {x, y} points',
    );
  }
  for (let i = 0; i < args.corners.length; i++) {
    const c = args.corners[i];
    if (c == null || typeof c !== 'object') {
      throw new InvalidOperationArgumentError(`corners[${i}]`, c, 'must be a {x, y} object');
    }
    assertFinite(`corners[${i}].x`, c.x);
    assertFinite(`corners[${i}].y`, c.y);
  }
  assertFinite('maxSpindle', args.maxSpindle);
  if (args.maxSpindle <= 0 || args.maxSpindle > MAX_SPINDLE_VALUE) {
    throw new InvalidOperationArgumentError(
      'maxSpindle', args.maxSpindle,
      `must be in (0, ${MAX_SPINDLE_VALUE}]`,
    );
  }
  if (args.frameDotFeedRateMmPerMin !== undefined) {
    assertFinite('frameDotFeedRateMmPerMin', args.frameDotFeedRateMmPerMin);
    if (args.frameDotFeedRateMmPerMin <= 0 || args.frameDotFeedRateMmPerMin > MAX_FEED_MM_PER_MIN) {
      throw new InvalidOperationArgumentError(
        'frameDotFeedRateMmPerMin', args.frameDotFeedRateMmPerMin,
        `must be in (0, ${MAX_FEED_MM_PER_MIN}]`,
      );
    }
  }
}

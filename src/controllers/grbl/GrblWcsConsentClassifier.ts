/**
 * T1-152: pure WCS-consent classifier extracted from
 * GrblController. Pre-T1-152 these types + `classifyWcsConsentInputs`
 * lived in the 2555-line controller file mixed with controller state.
 * The classifier was already exported (T1-117 made it pure +
 * exportable so the fail-closed branches could be pinned). Hoisting
 * it to its own module:
 *
 *   - Groups the discriminated union, the tolerance constant, and
 *     the classifier in one focused file
 *   - Lets tests import from a tight ~50-line module instead of the
 *     monster GrblController file
 *   - Shrinks GrblController.ts toward the audit's controller-cleanup
 *     goal
 *
 * GrblController re-exports the types + function so existing imports
 * keep working unchanged.
 *
 * The T1-117 contract is preserved verbatim: a missing G54 wins over
 * a missing $10 because an unknown G54 with a known $10=0 still
 * risks overwriting a user-set workspace offset; flagging G54 first
 * gives a more actionable diagnostic.
 */

/**
 * T1-117: reasons the WCS-verification path can declare unknown.
 *
 * Pre-T1-117 the controller treated every one of these as "looks
 * baseline" and silently ran applyWcsNormalization, rewriting G54
 * and $10 without user consent. Post-T1-117 each one fail-closes
 * the start-job gate via `_placementUncertain = true`.
 */
export type WcsUncertainReason =
  | 'missing_g54'         // [G54:...] line never arrived in response to $#.
  | 'malformed_g54'       // [G54:...] line had unparseable coordinates (NaN).
  | 'missing_status_mask' // $10 was not in the cached settings dump.
  | 'malformed_status_mask' // $10 was present but parseInt yielded NaN.
  /**
   * T1-174 (audit Critical #5): `$#` returned an `error:` response.
   * Pre-T1-174 this case called `skipWcsNormalization()` which marked
   * placement as TRUSTED — a fail-OPEN bug that authorized saved-
   * origin jobs to start from an unknown WCS offset. Post-T1-174 the
   * controller marks placement uncertain with this reason and blocks
   * start until the user disconnects + reconnects from a known-safe
   * state.
   */
  | 'wcs_query_error';

/**
 * T1-117: discriminated union for the WCS-verification verdict. The
 * three cases drive `_emitWcsConsentNeeded`:
 *
 * - `verified-zero`: both G54 and $10 are explicitly the GRBL baseline
 *   (G54=0,0,0 and $10=0). `applyWcsNormalization` runs without
 *   prompting because there's nothing to overwrite.
 * - `verified-nonzero`: both reads succeeded and at least one is
 *   non-baseline. Emits a consent payload to the UI listener (T1-20).
 * - `unknown`: at least one read is missing or malformed. Refuse to
 *   auto-apply; mark placement-uncertain.
 */
export type WcsConsentVerdict =
  | { kind: 'verified-zero' }
  | { kind: 'verified-nonzero'; g54: { x: number; y: number; z: number } | null; statusMask: number }
  | { kind: 'unknown'; reason: WcsUncertainReason };

const WCS_BASELINE_TOLERANCE = 0.0005;

/**
 * T1-117: pure classifier for the inputs to the WCS consent flow.
 *
 * Order: surface the most concrete reason first. The G54 read goes
 * before the $10 read because G54 is the larger source of risk —
 * an unknown G54 with a known $10=0 still risks overwriting a
 * workspace offset the user actually set; flagging the G54 cause
 * gives them a more actionable diagnostic.
 */
export function classifyWcsConsentInputs(
  g54: { x: number; y: number; z: number } | null,
  statusMaskRaw: string | null,
): WcsConsentVerdict {
  if (g54 == null) {
    return { kind: 'unknown', reason: 'missing_g54' };
  }
  if (
    !Number.isFinite(g54.x)
    || !Number.isFinite(g54.y)
    || !Number.isFinite(g54.z)
  ) {
    return { kind: 'unknown', reason: 'malformed_g54' };
  }

  if (statusMaskRaw == null) {
    return { kind: 'unknown', reason: 'missing_status_mask' };
  }
  const parsed = parseInt(statusMaskRaw, 10);
  if (!Number.isFinite(parsed)) {
    return { kind: 'unknown', reason: 'malformed_status_mask' };
  }
  const statusMask = parsed;

  const g54IsZero =
    Math.abs(g54.x) < WCS_BASELINE_TOLERANCE
    && Math.abs(g54.y) < WCS_BASELINE_TOLERANCE
    && Math.abs(g54.z) < WCS_BASELINE_TOLERANCE;
  const maskIsZero = statusMask === 0;

  if (g54IsZero && maskIsZero) {
    return { kind: 'verified-zero' };
  }
  return { kind: 'verified-nonzero', g54, statusMask };
}

/**
 * T1-41: saved-origin verification — compare a snapshot of G54 taken
 * at Set Origin time against the freshly-queried G54 at job start.
 * If they differ by more than the tolerance, block the operation —
 * the work coordinate system has drifted and the burn would land in
 * the wrong place.
 *
 * The drift can come from:
 *   - User typing `G10` or `G92` in the raw command console.
 *   - A custom-start template containing `G10` / `G92` (caught by
 *     the template validator, but defensive here).
 *   - A reconnect that fired `applyWcsNormalization` (zeroing G54).
 *   - Firmware lost power between sessions and lost G54.
 *   - User manually unlocked the alarm and ran other commands.
 *
 * This module is intentionally a pure helper — controller queries
 * happen at the call sites (App.tsx, ConnectionPanelMain.tsx). That
 * keeps the policy testable without spinning up a full controller.
 */

/** Tolerance in millimetres for considering two G54 offsets "the same". */
export const G54_DRIFT_TOLERANCE_MM = 0.01;

export interface G54Offset {
  x: number;
  y: number;
  z: number;
}

export type SavedOriginVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'not-savedorigin' | 'no-controller' | 'no-snapshot' | 'no-current-g54' | 'drift';
      drift?: { axis: 'x' | 'y' | 'z'; expected: number; actual: number; deltaMm: number };
    };

/**
 * Compare an `expectedG54` snapshot (captured at Set Origin time)
 * against `currentG54` (freshly queried at job start). Returns
 * `{ ok: true }` if all three axes match within tolerance.
 *
 * Caller responsibilities:
 *   - Pre-check that `startMode === 'savedOrigin'` (otherwise this
 *     check doesn't apply).
 *   - Pre-check `currentG54` is non-null — null means the controller
 *     didn't respond to `$#` in time, which itself should block.
 *   - Pre-check `expectedG54` is non-null — null means Set Origin
 *     was never run this session (or savedOrigin was invalidated).
 */
export function verifySavedOriginG54(
  expectedG54: G54Offset | null,
  currentG54: G54Offset | null,
  tolerance: number = G54_DRIFT_TOLERANCE_MM,
): SavedOriginVerifyResult {
  if (!expectedG54) return { ok: false, reason: 'no-snapshot' };
  if (!currentG54) return { ok: false, reason: 'no-current-g54' };

  const dx = currentG54.x - expectedG54.x;
  const dy = currentG54.y - expectedG54.y;
  const dz = currentG54.z - expectedG54.z;

  if (Math.abs(dx) > tolerance) {
    return {
      ok: false,
      reason: 'drift',
      drift: { axis: 'x', expected: expectedG54.x, actual: currentG54.x, deltaMm: dx },
    };
  }
  if (Math.abs(dy) > tolerance) {
    return {
      ok: false,
      reason: 'drift',
      drift: { axis: 'y', expected: expectedG54.y, actual: currentG54.y, deltaMm: dy },
    };
  }
  if (Math.abs(dz) > tolerance) {
    return {
      ok: false,
      reason: 'drift',
      drift: { axis: 'z', expected: expectedG54.z, actual: currentG54.z, deltaMm: dz },
    };
  }
  return { ok: true };
}

/** User-facing message for a `drift` verification failure. */
export function describeSavedOriginDrift(drift: NonNullable<Exclude<SavedOriginVerifyResult, { ok: true }>['drift']>): string {
  return (
    `Saved origin is no longer valid — the work coordinate system has changed since you set the origin. `
    + `${drift.axis.toUpperCase()} axis drifted by ${drift.deltaMm.toFixed(3)} mm `
    + `(expected ${drift.expected.toFixed(3)}, machine reports ${drift.actual.toFixed(3)}). `
    + `Set Origin again on the workpiece, or switch to absolute / from-laser-head mode.`
  );
}

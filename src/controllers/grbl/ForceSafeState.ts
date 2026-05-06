/**
 * T2-129: destructive `forceSafeState()` primitive — operator-
 * initiated force-safe-state recovery + T1-29 acknowledgement
 * integration. Pre-T2-129 a user who hit an alarm at end-of-job had
 * no in-app affordance to reset; they had to switch to the GRBL
 * console + send `$X` / soft-reset / cycle-start, or disconnect +
 * power-cycle. Audit 1D required fix (the destructive half of T1-25's
 * non-destructive observation pair).
 *
 * T2-129 ships the result type + the pure outcome classifier + the
 * post-reset status validator. Wiring this onto `GrblController`
 * (the actual `writeByteCritical(REALTIME_RESET)` + banner-wait +
 * status-query orchestration) is filed as T2-129-followup since
 * it touches a safety code path on the live controller and gets the
 * heightened-bar review (CLAUDE.md: "Hardware-touching changes get
 * a 'Hardware verification needed' note in the commit message").
 */

import type { ControllerStatus } from '../../app/MachineSafetyState';

export type ForceSafeStateFailureReason =
  | 'no-banner-response'
  | 'no-status-response'
  | 'fs-not-zero'
  | 'still-non-idle';

export type ForceSafeStateResult =
  | { ok: true; state: ControllerStatus }
  | {
      ok: false;
      reason: ForceSafeStateFailureReason;
      actual?: { feedRate: number; spindleSpeed: number; status: ControllerStatus };
    };

/** GRBL realtime soft-reset byte (0x18). */
export const REALTIME_RESET = 0x18;
/** GRBL '?' character — the realtime status query. */
export const REALTIME_STATUS_QUERY = 0x3f;

/**
 * Pure post-reset validator. Inputs: whether the GRBL banner was
 * observed, whether a status report was observed, and the parsed
 * status. Outputs the canonical `ForceSafeStateResult` shape.
 *
 * Used by `GrblController.forceSafeState` (T2-129-followup) once the
 * port-level orchestration is in place; usable independently for
 * tests without a live port.
 */
export interface PostResetObservations {
  /** True when the GRBL `Grbl 1.1h [...]` banner was received. */
  bannerReceived: boolean;
  /** Status parsed from the post-reset `<...>` report; null when none received. */
  statusReport: { feedRate: number; spindleSpeed: number; status: ControllerStatus } | null;
}

export function evaluateForceSafeState(obs: PostResetObservations): ForceSafeStateResult {
  if (!obs.bannerReceived) {
    return { ok: false, reason: 'no-banner-response' };
  }
  if (obs.statusReport == null) {
    return { ok: false, reason: 'no-status-response' };
  }
  if (obs.statusReport.feedRate !== 0 || obs.statusReport.spindleSpeed !== 0) {
    return {
      ok: false, reason: 'fs-not-zero', actual: obs.statusReport,
    };
  }
  if (obs.statusReport.status !== 'idle') {
    return { ok: false, reason: 'still-non-idle', actual: obs.statusReport };
  }
  return { ok: true, state: obs.statusReport.status };
}

/**
 * Predicate the operator-button gate consults. `forceSafeState()`
 * is meaningful only when the controller is in a non-clean state —
 * `alarm` / `hold` / `run`. Calling it from idle is a no-op
 * (technically harmless but generates user-visible reset noise).
 */
export function shouldOfferForceSafeState(status: ControllerStatus): boolean {
  return status === 'alarm' || status === 'hold' || status === 'run' || status === 'door';
}

/**
 * User-facing failure message. The recovery dialog (T1-29 + T2-129
 * followup) renders this when `forceSafeState` returns `ok: false`.
 */
export function forceSafeStateFailureMessage(result: ForceSafeStateResult): string | null {
  if (result.ok) return null;
  switch (result.reason) {
    case 'no-banner-response':
      return 'Controller did not respond to soft reset. The connection may be stale. Try disconnecting and reconnecting.';
    case 'no-status-response':
      return 'Controller reset but did not report status. The connection may be stale.';
    case 'fs-not-zero': {
      const fr = result.actual?.feedRate ?? 0;
      const ss = result.actual?.spindleSpeed ?? 0;
      return `Controller reset, but feed/spindle is not zero (F${fr} S${ss}). The machine may still be running. Stop the job and try again.`;
    }
    case 'still-non-idle': {
      const s = result.actual?.status ?? 'unknown';
      const action = s === 'alarm'
        ? 'send $X to clear the alarm'
        : s === 'hold' ? 'send a cycle-start (~) to resume'
        : 'wait for the controller to reach idle';
      return `Controller is in '${s}' state after reset. ${action.charAt(0).toUpperCase() + action.slice(1)}.`;
    }
  }
}

/**
 * Confirmation copy for the operator button. `forceSafeState` is
 * DESTRUCTIVE — it issues a soft-reset which:
 *   - aborts any running job
 *   - clears the controller's command queue
 *   - resets the controller position counter (T2-66 marks position
 *     untrusted)
 *   - does NOT clear an alarm (alarm requires explicit `$X`)
 *
 * The UI must surface this confirmation dialog before the call.
 */
export interface ForceSafeStateConfirmation {
  title: string;
  message: string;
  consequences: string[];
  confirmLabel: string;
  cancelLabel: string;
}

export function forceSafeStateConfirmation(
  currentStatus: ControllerStatus,
): ForceSafeStateConfirmation {
  const consequences: string[] = [];
  if (currentStatus === 'run') {
    consequences.push('Any running job will be aborted.');
  }
  if (currentStatus === 'hold') {
    consequences.push('The held job will be abandoned (cannot be resumed after reset).');
  }
  consequences.push('Controller position will be cleared — re-home before the next motion.');
  if (currentStatus === 'alarm') {
    consequences.push('Soft reset alone does NOT clear the alarm; you may need to send $X afterwards.');
  }
  return {
    title: 'Force machine to safe state?',
    message: `This will issue a soft reset to the controller. The current state is '${currentStatus}'.`,
    consequences,
    confirmLabel: 'Reset',
    cancelLabel: 'Cancel',
  };
}

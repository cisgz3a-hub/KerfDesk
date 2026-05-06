/**
 * T2-46: user-facing safety outcome messages. Pre-T2-46 most safety
 * operations rendered generic copy ("Disconnected", "Stopped")
 * without distinguishing clean shutdown vs cable-pull vs
 * emergency-stop vs handshake-failed; the user could not tell from
 * the UI whether the laser had actually been verified off, only
 * commanded off, or whether reconnect / rehome / inspection was
 * required.
 *
 * Audit 3D Required P2 "user-facing safety outcome messages".
 *
 * T2-46 ships the formatter (typed presentation layer over T2-41
 * SafetyActionResult) + the Activity-Log-row builder so safety
 * actions can be recorded with timestamp + outcome for incident
 * analysis. Wiring `formatSafetyOutcome` into UI surfaces (toast,
 * banner, modal, Activity Log panel) is filed as T2-46-followup
 * since each surface is a per-callsite review.
 */

import type {
  SafetyActionResult,
  SafetyAction,
} from '../../app/SafetyActionResult';

/**
 * Severity tier for the rendered message — drives styling +
 * persistence. `confirmed-safe` is dismissable; `commanded-unverified`
 * surfaces a yellow caution; `unknown-unsafe` is red persistent;
 * `unsupported` is informational.
 */
export type SafetyOutcomeSeverity =
  | 'confirmed-safe'
  | 'commanded-unverified'
  | 'unknown-unsafe'
  | 'unsupported';

export interface UserSafetyMessage {
  readonly severity: SafetyOutcomeSeverity;
  readonly title: string;
  readonly body: string;
  readonly actionable: string | null;
}

/**
 * Map a SafetyActionResult into a typed user-facing message. The
 * formatter inspects `accepted`, the tristate observable fields,
 * and the action discriminator to build copy that matches what
 * actually happened — no generic "Stopped".
 */
export function formatSafetyOutcome(result: SafetyActionResult): UserSafetyMessage {
  if (!result.accepted) {
    // Capability-not-supported / not-connected branch
    return {
      severity: 'unsupported',
      title: titleForRefusal(result.action),
      body: result.message ?? 'Operation could not be performed.',
      actionable: null,
    };
  }
  // accepted = true — classify by motion / laser / position outcomes
  if (result.requiresInspection) {
    return {
      severity: 'unknown-unsafe',
      title: 'Inspect machine',
      body: result.message ??
        'Controller state unknown after the operation. Inspect the machine before reconnecting.',
      actionable: 'Inspect the machine + workpiece before further commands.',
    };
  }
  if (result.requiresReconnect) {
    return {
      severity: 'unknown-unsafe',
      title: 'Reconnect required',
      body: result.message ?? 'Connection is in a state that needs reopening.',
      actionable: 'Disconnect, then reconnect.',
    };
  }
  if (result.laserState === 'commandedOff' && result.action === 'laserOff') {
    return {
      severity: 'commanded-unverified',
      title: 'Laser-off commanded',
      body: 'Laser-off command sent; verification unavailable on this controller.',
      actionable: 'Visually confirm the laser is off before approaching the machine.',
    };
  }
  if (result.action === 'abortJob' || result.action === 'emergencyStop') {
    if (result.requiresRehome === true) {
      return {
        severity: 'commanded-unverified',
        title: result.action === 'emergencyStop' ? 'Emergency stop sent' : 'Job aborted',
        body: result.message ??
          'Job aborted. GRBL soft reset sent. Position may be lost.',
        actionable: 'Re-home before next job.',
      };
    }
    return {
      severity: 'confirmed-safe',
      title: result.action === 'emergencyStop' ? 'Emergency stop sent' : 'Job aborted',
      body: result.message ?? 'Job stopped. Position retained.',
      actionable: null,
    };
  }
  if (result.action === 'pause') {
    return {
      severity: 'confirmed-safe',
      title: 'Paused',
      body: result.message ?? 'Job paused. Resume when ready.',
      actionable: null,
    };
  }
  if (result.action === 'resume') {
    return {
      severity: 'confirmed-safe',
      title: 'Resumed',
      body: result.message ?? 'Job resumed.',
      actionable: null,
    };
  }
  if (result.action === 'disconnectSafe') {
    return {
      severity: 'confirmed-safe',
      title: 'Disconnected',
      body: result.message ?? 'Controller disconnected cleanly.',
      actionable: null,
    };
  }
  if (result.action === 'beginTestFire') {
    return {
      severity: 'commanded-unverified',
      title: 'Test fire active',
      body: 'Test fire in progress. Hold deadman to continue.',
      actionable: 'Release deadman to end.',
    };
  }
  if (result.action === 'endTestFire') {
    return {
      severity: 'confirmed-safe',
      title: 'Test fire ended',
      body: 'Laser commanded off after test fire.',
      actionable: null,
    };
  }
  // Default: laserOff that succeeded
  return {
    severity: 'confirmed-safe',
    title: 'Operation complete',
    body: result.message ?? 'Operation completed.',
    actionable: null,
  };
}

function titleForRefusal(action: SafetyAction): string {
  switch (action) {
    case 'laserOff':       return 'Laser-off unavailable';
    case 'pause':          return 'Pause not supported';
    case 'resume':         return 'Resume not supported';
    case 'abortJob':       return 'Abort not supported';
    case 'emergencyStop':  return 'Emergency stop unavailable';
    case 'disconnectSafe': return 'Disconnect failed';
    case 'beginTestFire':  return 'Test fire unavailable';
    case 'endTestFire':    return 'Test fire end failed';
  }
}

/**
 * Activity-Log row shape for the persistent "Safety Activity Log"
 * panel referenced by audit 3D. One row per safety action, with
 * the same severity classification as the in-the-moment toast.
 */
export interface ActivityLogRow {
  readonly id: string;
  readonly timestamp: number;
  readonly action: SafetyAction;
  readonly accepted: boolean;
  readonly severity: SafetyOutcomeSeverity;
  readonly title: string;
  readonly body: string;
  readonly actionable: string | null;
}

/**
 * Build an Activity-Log row from a SafetyActionResult. `id` is
 * deterministic-friendly (caller supplies; default uses the
 * timestamp + action so offline replay is stable).
 */
export function buildActivityLogRow(
  result: SafetyActionResult,
  id?: string,
): ActivityLogRow {
  const message = formatSafetyOutcome(result);
  return {
    id: id ?? `${result.timestamp}-${result.action}`,
    timestamp: result.timestamp,
    action: result.action,
    accepted: result.accepted,
    severity: message.severity,
    title: message.title,
    body: message.body,
    actionable: message.actionable,
  };
}

/**
 * UI styling gate: should the message be shown as a persistent
 * banner (red) instead of a dismissable toast?
 */
export function isPersistentSeverity(severity: SafetyOutcomeSeverity): boolean {
  return severity === 'unknown-unsafe';
}

/**
 * Predicate the export-bundle flow consults: does this row count
 * as a "safety incident" worth highlighting in support-bundle
 * exports? `unknown-unsafe` always; `commanded-unverified` when
 * tied to an abort/e-stop (post-job position-untrusted state).
 */
export function isIncidentWorthy(row: ActivityLogRow): boolean {
  if (row.severity === 'unknown-unsafe') return true;
  if (row.severity === 'commanded-unverified' &&
      (row.action === 'abortJob' || row.action === 'emergencyStop')) {
    return true;
  }
  return false;
}

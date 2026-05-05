/**
 * T2-66: explicit `PositionTrust` state. Pre-T2-66 the codebase had
 * no flag tracking whether the controller's reported position
 * actually matches the machine's physical position. After alarm
 * (soft reset), emergency stop (controller reset), disconnect mid-
 * job, manual realtime command from the console, or a failed frame,
 * the controller reports numbers but those numbers are no longer
 * trustworthy — and yet the user could press Start.
 *
 * Audit 4C Required Priority 9 + "Misleading state 4" calls out the
 * gap. T2-66 ships the type, the transition function (every event
 * that affects trust + every action that restores it), and the
 * `canStartJobUnderTrust` predicate. Wiring this into `MachineState`
 * + `canStartJob` + UI banner is filed as T2-66-followup so the
 * cross-cutting integration lands in one focused pass.
 */

/**
 * Why position trust was lost. Each reason carries different
 * downstream consequences:
 * - `never-homed`: app-start state; pre-T1-31 home flow.
 * - `soft-reset` / `emergency-stop`: GRBL position counter was reset.
 * - `disconnect`: the host lost the controller mid-job; what the
 *   firmware did between disconnect and reconnect is unknown.
 * - `manual-command`: the user issued a realtime command from the
 *   console (jog, home cancel, etc) that we don't track in plan
 *   coordinates.
 * - `frame-failed`: a frame command was rejected mid-flight, so the
 *   machine is at an indeterminate position along the frame path.
 */
export type PositionTrustLostReason =
  | 'never-homed'
  | 'soft-reset'
  | 'emergency-stop'
  | 'disconnect'
  | 'manual-command'
  | 'frame-failed';

export type PositionTrust =
  | { trusted: true }
  | { trusted: false; reason: PositionTrustLostReason; lostAt: number };

/**
 * Events that can affect trust. `home-success` and `frame-success`
 * RESTORE trust because the firmware confirmed reaching a known
 * point. `save-origin` restores because the user is explicitly
 * asserting the current position is what they want as origin.
 */
export type PositionTrustEvent =
  | { kind: 'home-success' }
  | { kind: 'home-cancel' }
  | { kind: 'soft-reset' }
  | { kind: 'emergency-stop' }
  | { kind: 'disconnect' }
  | { kind: 'manual-command' }
  | { kind: 'frame-success' }
  | { kind: 'frame-fail' }
  | { kind: 'unlock' }   // $X — does NOT restore trust (audit "Misleading state 3")
  | { kind: 'save-origin' };

/** Initial state at app startup, before homing. */
export function initialPositionTrust(): PositionTrust {
  return { trusted: false, reason: 'never-homed', lostAt: 0 };
}

/**
 * Apply an event to the current trust state. The pure function form
 * makes this trivially unit-testable; the wiring layer (T2-66-
 * followup) embeds it in MachineState.setStatus / safety-event paths.
 */
export function transitionPositionTrust(
  current: PositionTrust,
  event: PositionTrustEvent,
  now: number,
): PositionTrust {
  switch (event.kind) {
    case 'home-success':
    case 'frame-success':
    case 'save-origin':
      return { trusted: true };
    case 'soft-reset':
      return { trusted: false, reason: 'soft-reset', lostAt: now };
    case 'emergency-stop':
      return { trusted: false, reason: 'emergency-stop', lostAt: now };
    case 'disconnect':
      return { trusted: false, reason: 'disconnect', lostAt: now };
    case 'manual-command':
      // Stays untrusted if already untrusted; otherwise becomes
      // untrusted because we don't track manual realtime motion.
      if (!current.trusted) return current;
      return { trusted: false, reason: 'manual-command', lostAt: now };
    case 'frame-fail':
      return { trusted: false, reason: 'frame-failed', lostAt: now };
    case 'home-cancel':
      // $H interrupted before completion — position not trustworthy.
      return current.trusted
        ? { trusted: false, reason: 'manual-command', lostAt: now }
        : current;
    case 'unlock':
      // Audit "Misleading state 3": $X clears alarm but does not restore
      // physical position. Trust state is unchanged.
      return current;
  }
}

/**
 * User-facing message for an untrusted state. Returns null when
 * trusted. Lives next to the type so a future i18n layer can be
 * applied in one place.
 */
export function positionTrustMessage(t: PositionTrust): string | null {
  if (t.trusted) return null;
  switch (t.reason) {
    case 'never-homed':
      return 'Position untrusted: machine has not been homed. Run $H or set the origin to continue.';
    case 'soft-reset':
      return 'Position untrusted: a soft reset cleared the controller position. Re-home, set the origin, or frame the design to restore.';
    case 'emergency-stop':
      return 'Position untrusted: emergency stop cleared the controller position. Re-home, set the origin, or frame the design to restore.';
    case 'disconnect':
      return 'Position untrusted: the controller was disconnected mid-job. Re-home or set the origin before continuing.';
    case 'manual-command':
      return 'Position untrusted: a manual command moved the head outside the planned path. Re-home, set origin, or frame the design.';
    case 'frame-failed':
      return 'Position untrusted: a frame command failed mid-flight. Re-home or set origin to restore.';
  }
}

/**
 * Predicate the start-job gate consults. `absolute` and `current`
 * start modes are permitted regardless of trust (the user is
 * accepting the risk by selecting them); `savedOrigin` requires
 * trust because saved origin was established BEFORE the trust-loss
 * event and is no longer guaranteed correct.
 */
export type StartMode = 'absolute' | 'current' | 'savedOrigin';

export function canStartJobUnderTrust(
  trust: PositionTrust,
  mode: StartMode,
): { allowed: true } | { allowed: false; reason: string } {
  if (trust.trusted) return { allowed: true };
  if (mode === 'savedOrigin') {
    return {
      allowed: false,
      reason: 'Saved-origin start requires trusted position. ' + (positionTrustMessage(trust) ?? ''),
    };
  }
  // absolute / current modes: user is asserting the current head
  // position is correct, so they are explicitly accepting the risk.
  return { allowed: true };
}

/**
 * T2-44: extended safety state machine — refines T2-12 with audit
 * 3D's richer state set. T2-12's `MachineSafetyState` (shipped in
 * `0633625`) covers the connect/run/idle/hold canonical surface.
 * T2-44 adds the in-flight transition states the audit's P1 calls
 * for: `pauseRequested`, `pausedVerified`, `abortRequested`,
 * `stoppedPositionUnknown`, `laserOffCommandedUnknown`, plus the
 * blocking states `unsafeUnknown` and `requiresInspection`.
 *
 * The audit's framing: GRBL pause sets controller state to 'hold'
 * optimistically before status confirms. Without `pauseRequested`
 * vs `pausedVerified`, the UI cannot distinguish "we sent the byte
 * and are waiting" from "controller acknowledged hold." T2-44
 * adds that distinction explicitly.
 *
 * T2-44 ships the 10-kind union + the transition function consuming
 * `SafetyActionResult` (T2-41). T2-44 status (T1-162 update): the
 * wiring is complete. `MachineService._recordSafetyResult` calls
 * `transitionFromSafetyResult` for every pause / resume / stop /
 * emergencyStop / disconnect outcome and updates `_safetyState` so
 * the UI can subscribe via `onSafetyStateChange`. The original
 * "Wiring the machine into MachineService is filed as
 * T2-44-followup" sentence was true at T2-44-shipped time but is
 * stale; the audit (docs/AUDIT-2026-05-11.md F-012) flagged the
 * drift.
 *
 * Pairs with T2-12 (canonical machine state — connect/idle/run);
 * T2-44 zooms in on the SAFETY-OPERATION transitions that wrap each
 * `pause`/`resume`/`stop`/`emergencyStop` call.
 */

/**
 * Safety operation kinds. Matches the audit's enumerated list with
 * one additional `none` discriminant for the fresh state.
 */
export type SafetyAction =
  | 'pause' | 'resume'
  | 'stop' | 'emergencyStop'
  | 'laserOff' | 'disconnectSafe'
  | 'beginTestFire' | 'endTestFire';

export type SafetyMotionState = 'unknown' | 'paused' | 'stopped' | 'moving';
export type SafetyLaserOffState = 'unknown' | 'commanded' | 'confirmed';
export type SafetyTristate = boolean | 'unknown';

/**
 * Subset of T2-41's `SafetyActionResult` consumed by the transition
 * function. Re-declared here so this module can compile without a
 * dependency on `src/app/SafetyActionResult.ts` (the existing file
 * is a per-method shape; T2-44 only needs the discriminating fields).
 */
export interface SafetyResultLike {
  action: SafetyAction;
  accepted: boolean;
  motionState: SafetyMotionState;
  laserState: SafetyLaserOffState;
  positionTrusted: SafetyTristate;
  requiresRehome?: SafetyTristate;
  requiresReconnect?: SafetyTristate;
  requiresInspection?: SafetyTristate;
  message?: string;
}

/**
 * The 10 audit-derived states + a `safeIdle` ground state. Each
 * carries the metadata the recovery / UI surface needs to render
 * the right copy + the right action set.
 */
export type SafetyState =
  | { kind: 'safeIdle' }
  | { kind: 'running' }
  | { kind: 'pauseRequested'; sentAt: number }
  | { kind: 'pausedVerified' }
  | { kind: 'abortRequested'; sentAt: number; emergency: boolean }
  | { kind: 'emergencyStopping'; sentAt: number }
  | { kind: 'stoppedPositionUnknown'; reason: string }
  | { kind: 'laserOffCommandedUnknown'; sentAt: number }
  | { kind: 'unsafeUnknown'; reason: string }
  | { kind: 'requiresInspection'; reason: string };

export type SafetyStateKind = SafetyState['kind'];

export const safetyStateInitial: SafetyState = { kind: 'safeIdle' };

/**
 * Transition function. Pure — no I/O. Pre-condition: `now` is the
 * unix-ms clock; tests inject a fixed value.
 */
export function transitionFromSafetyResult(
  current: SafetyState,
  result: SafetyResultLike,
  now: number,
): SafetyState {
  switch (result.action) {
    case 'pause': {
      if (!result.accepted) {
        return { kind: 'unsafeUnknown', reason: result.message ?? 'Pause not accepted' };
      }
      if (result.motionState === 'paused') return { kind: 'pausedVerified' };
      return { kind: 'pauseRequested', sentAt: now };
    }
    case 'resume': {
      if (!result.accepted) {
        return { kind: 'unsafeUnknown', reason: result.message ?? 'Resume not accepted' };
      }
      // After resume the controller is back to running until the next
      // event. Verification of motion comes through subsequent status.
      return { kind: 'running' };
    }
    case 'stop':
    case 'emergencyStop': {
      const isEmergency = result.action === 'emergencyStop';
      if (!result.accepted) {
        return {
          kind: 'unsafeUnknown',
          reason: result.message ?? `${isEmergency ? 'Emergency stop' : 'Stop'} not accepted`,
        };
      }
      if (result.requiresInspection === true) {
        return { kind: 'requiresInspection', reason: result.message ?? 'Stop completed but inspection required' };
      }
      if (result.positionTrusted === false || result.requiresRehome === true) {
        return {
          kind: 'stoppedPositionUnknown',
          reason: result.message ?? 'Position not trusted; re-home before next motion',
        };
      }
      if (result.motionState === 'stopped') {
        return { kind: 'safeIdle' };
      }
      // Stop accepted but motion not yet confirmed
      return { kind: 'abortRequested', sentAt: now, emergency: isEmergency };
    }
    case 'laserOff': {
      if (!result.accepted) {
        return { kind: 'unsafeUnknown', reason: result.message ?? 'Laser off not accepted' };
      }
      if (result.laserState === 'confirmed') {
        // Don't downgrade an actively-running job's state on a
        // standalone laser-off; only the safeIdle baseline is the
        // appropriate landing for a SUCCESSFUL laser-off when the
        // machine isn't running.
        return current.kind === 'running' || current.kind === 'pauseRequested'
          || current.kind === 'pausedVerified'
          ? current
          : { kind: 'safeIdle' };
      }
      return { kind: 'laserOffCommandedUnknown', sentAt: now };
    }
    case 'disconnectSafe': {
      if (!result.accepted) {
        return { kind: 'unsafeUnknown', reason: result.message ?? 'Disconnect not accepted' };
      }
      // Disconnect doesn't change SAFETY state; T2-12 owns the
      // disconnect taxonomy. Stay in current state.
      return current;
    }
    case 'beginTestFire':
    case 'endTestFire': {
      if (!result.accepted) {
        return { kind: 'unsafeUnknown', reason: result.message ?? `${result.action} not accepted` };
      }
      // Test-fire transitions handled by T2-12 (RUNNING_TEMP_LASER);
      // T2-44 stays in current.
      return current;
    }
  }
}

/**
 * The two states that BLOCK all subsequent commands until the user
 * explicitly clears. UI must surface a recovery dialog before any
 * other operation can proceed.
 */
export function safetyStateBlocksAllCommands(state: SafetyState): boolean {
  return state.kind === 'unsafeUnknown' || state.kind === 'requiresInspection';
}

/**
 * Predicate for the start-job gate. Refines T2-12's
 * `safetyStateAllowsStartJob`: for SAFETY-MACHINE state, only
 * `safeIdle` permits starting a new job.
 */
export function safetyStateAllowsStartJob(state: SafetyState): boolean {
  return state.kind === 'safeIdle';
}

/**
 * Whether resume is the right next step. Only `pausedVerified` —
 * pauseRequested still awaits verification.
 */
export function safetyStateAllowsResume(state: SafetyState): boolean {
  return state.kind === 'pausedVerified';
}

/**
 * After `stoppedPositionUnknown`, the user must re-home (or save
 * origin) to clear. This predicate gates the recovery clear-action.
 */
export function safetyStateRequiresRehome(state: SafetyState): boolean {
  return state.kind === 'stoppedPositionUnknown';
}

/**
 * Apply user clearance — used by the "I have inspected and
 * re-homed" recovery action and the manual "Continue" out of
 * `unsafeUnknown` (after the user has confirmed the safe state).
 *
 * The transition is permissive: returns `safeIdle` regardless of
 * source. Caller must enforce the user-confirmation step.
 */
export function clearToSafeIdle(): SafetyState {
  return { kind: 'safeIdle' };
}

/**
 * User-facing label per kind. Used by the activity log + recovery
 * dialog header.
 */
export function safetyStateLabel(state: SafetyState): string {
  switch (state.kind) {
    case 'safeIdle': return 'Safe — idle';
    case 'running': return 'Running';
    case 'pauseRequested': return 'Pause requested — awaiting verification';
    case 'pausedVerified': return 'Paused';
    case 'abortRequested':
      return state.emergency
        ? 'Emergency stop in flight — awaiting verification'
        : 'Stop requested — awaiting verification';
    case 'emergencyStopping': return 'Emergency stopping…';
    case 'stoppedPositionUnknown': return `Stopped — position not trusted (${state.reason})`;
    case 'laserOffCommandedUnknown': return 'Laser off commanded — awaiting confirmation';
    case 'unsafeUnknown': return `Unsafe state — ${state.reason}`;
    case 'requiresInspection': return `Inspection required — ${state.reason}`;
  }
}

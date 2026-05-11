/**
 * T2-41: typed result for safety method invocations.
 *
 * Pre-T2-41 every safety method on the controller (pause / resume /
 * stop / emergencyStop) returned `void`. Callers couldn't tell
 * whether the command was sent, whether the port was open, whether
 * laser-off was attempted, whether motion was confirmed stopped,
 * whether position was invalidated, whether reconnect / rehome was
 * required, or whether the user must inspect the machine. The
 * audit's framing (3D Critical 1 + 6 + Required P0): "controller-
 * specific safety contract — for an audit trail / incident log /
 * post-mortem analysis, the void return loses information the
 * caller could meaningfully use."
 *
 * T2-41 status (T1-162 update): the migration is complete.
 * `GrblController.pause / resume / stop / emergencyStop / safetyOff /
 * acknowledgeFault` all return `SafetyActionResult` (or the
 * structured `{stage, error}` shape for safetyOff) today.
 * `MachineService.disconnect / emergencyStop` capture the result and
 * route through `_recordSafetyResult` into the T2-44 state machine.
 * The original "T2-41-followup migrates the remaining methods one-
 * by-one" sentence was true at T2-41-shipped time but is stale post
 * T2-12 + T2-44 wave; the audit (docs/AUDIT-2026-05-11.md F-012)
 * flagged the drift.
 */

export type SafetyAction =
  | 'laserOff'
  | 'pause'
  | 'resume'
  | 'abortJob'
  | 'emergencyStop'
  | 'disconnectSafe'
  | 'beginTestFire'
  | 'endTestFire';

export type MotionState = 'stopped' | 'paused' | 'running' | 'unknown';
export type LaserOffState = 'off' | 'commandedOff' | 'unknown';
export type Tristate = boolean | 'unknown';

/**
 * Structured outcome of a safety operation. Fields are populated by
 * what the controller can actually know — GRBL knows it sent
 * `0x18` for soft-reset, knows that flips its internal abort state,
 * but doesn't get a per-byte ack so `laserState` is `commandedOff`,
 * not `off`. Higher-protocol controllers (Ruida, Trocen) might
 * verify and report `off`. The type is shared; the per-controller
 * implementation populates accurately.
 */
export interface SafetyActionResult {
  action: SafetyAction;
  /** True when the command was sent without throwing AND the
   *  controller-side preconditions (e.g. port open) held. */
  accepted: boolean;
  motionState: MotionState;
  laserState: LaserOffState;
  /** Position trust: `false` after a soft reset (GRBL spec); `true`
   *  if motion was halted via feed-hold without a position-clearing
   *  side-effect; `'unknown'` when the controller can't tell. */
  positionTrusted: Tristate;
  /** True when GRBL's soft reset cleared the position so the user
   *  must `$H` before the next job. */
  requiresRehome: Tristate;
  /** True when the port had to be closed or is in a state that
   *  needs reopening before further commands. */
  requiresReconnect: boolean;
  /** True when the user should physically inspect the machine
   *  (workpiece, head position, safety interlocks) before further
   *  commands. Reserved for emergency-stop and limit-switch hits. */
  requiresInspection: boolean;
  /** Optional human-readable summary; safe to surface in a job-log
   *  audit trail or a recovery dialog. */
  message?: string;
  /** Epoch ms; included for audit-trail use. */
  timestamp: number;
}

/**
 * Outcome shape for a successful GRBL soft-reset stop. Captures the
 * GRBL-spec semantics: 0x18 forces laser off but we can't observe
 * per-byte completion (commandedOff, not verified off); position is
 * lost; rehome required; reconnect not required (port stays open).
 */
export function makeSoftResetStopResult(message?: string): SafetyActionResult {
  return {
    action: 'abortJob',
    accepted: true,
    motionState: 'stopped',
    laserState: 'commandedOff',
    positionTrusted: false,
    requiresRehome: true,
    requiresReconnect: false,
    requiresInspection: false,
    message: message ?? 'GRBL soft reset sent. Position lost; rehome required.',
    timestamp: Date.now(),
  };
}

/**
 * Outcome shape when a safety method runs against a port that's
 * already closed. Caller must reconnect before further commands.
 */
export function makeNotConnectedResult(action: SafetyAction): SafetyActionResult {
  return {
    action,
    accepted: false,
    motionState: 'unknown',
    laserState: 'unknown',
    positionTrusted: 'unknown',
    requiresRehome: 'unknown',
    requiresReconnect: true,
    requiresInspection: false,
    message: 'Port not connected.',
    timestamp: Date.now(),
  };
}

export function makePauseResult(message?: string): SafetyActionResult {
  return {
    action: 'pause',
    accepted: true,
    motionState: 'paused',
    laserState: 'commandedOff',
    positionTrusted: true,
    requiresRehome: false,
    requiresReconnect: false,
    requiresInspection: false,
    message: message ?? 'Pause command sent. Motion is feed-held; laser-off command sent.',
    timestamp: Date.now(),
  };
}

export function makeResumeResult(message?: string): SafetyActionResult {
  return {
    action: 'resume',
    accepted: true,
    motionState: 'running',
    laserState: 'unknown',
    positionTrusted: true,
    requiresRehome: false,
    requiresReconnect: false,
    requiresInspection: false,
    message: message ?? 'Resume command sent.',
    timestamp: Date.now(),
  };
}

export function makeDisconnectResult(args?: {
  accepted?: boolean;
  message?: string;
}): SafetyActionResult {
  const accepted = args?.accepted ?? true;
  return {
    action: 'disconnectSafe',
    accepted,
    motionState: accepted ? 'stopped' : 'unknown',
    laserState: accepted ? 'commandedOff' : 'unknown',
    positionTrusted: 'unknown',
    requiresRehome: 'unknown',
    requiresReconnect: true,
    requiresInspection: false,
    message: args?.message ?? (
      accepted
        ? 'Disconnected safely. Laser-off command sent before closing the port.'
        : 'Disconnect did not complete cleanly. Reconnect before sending more commands.'
    ),
    timestamp: Date.now(),
  };
}

export function makeEmergencyStopResult(args?: {
  accepted?: boolean;
  message?: string;
}): SafetyActionResult {
  const accepted = args?.accepted ?? true;
  return {
    action: 'emergencyStop',
    accepted,
    motionState: accepted ? 'stopped' : 'unknown',
    laserState: accepted ? 'commandedOff' : 'unknown',
    positionTrusted: false,
    requiresRehome: true,
    requiresReconnect: true,
    requiresInspection: true,
    message: args?.message ?? (
      accepted
        ? 'Emergency stop sent. GRBL soft reset issued; inspect the machine, reconnect, and re-home before the next job.'
        : 'Emergency stop could not be confirmed. Inspect the machine before reconnecting.'
    ),
    timestamp: Date.now(),
  };
}

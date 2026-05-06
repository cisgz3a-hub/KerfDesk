/**
 * T2-12: canonical `MachineSafetyState` discriminated union.
 * Pre-T2-12 the codebase had safety fields scattered across
 * `MachineState.status`, `laserOutputState` (T1-22), `unsafePriorState`
 * (T1-29), and `activeOperation` (T2-11) — UI gates derived their
 * "can the user click this?" answers from ad-hoc combinations of
 * those fields. Audit 1E identified this as the central architectural
 * gap.
 *
 * T2-12 ships the canonical types + the pure derivation function —
 * `computeMachineSafetyState(...)`. Migrating UI gates (T1-30
 * `computeCommandGates` etc.) to consume the canonical state is
 * filed as T2-12-followup; the migration is mechanical once the
 * canonical type is in place.
 *
 * The audit's pushback note applies: the type emerges from the work,
 * not before it. Every state field this union names already existed
 * in scattered form before T2-12; this ticket is the consolidation
 * pass.
 */

/** GRBL-style status string the controller reports today. */
export type ControllerStatus =
  | 'idle' | 'run' | 'hold' | 'jog' | 'alarm' | 'door' | 'check' | 'home' | 'sleep'
  | 'unknown';

/**
 * Confidence of the laser-output state. T1-22 introduced
 * `laserOutputState` as `'off' | 'on' | 'unknown'`; T2-12 widens to
 * distinguish "we commanded off, but didn't read back" (the GRBL M5
 * case) from "we have proof the laser is off."
 */
export type LaserOutputState =
  | 'OFF_CONFIRMED'
  | 'ON_COMMANDED'
  | 'OFF_COMMANDED_UNVERIFIED'
  | 'UNKNOWN';

/**
 * What kind of disconnect we observed. T1-29 introduced
 * `unsafePriorState`; T2-12 expands to a typed taxonomy so the
 * recovery dialog can render the right copy per kind.
 */
export type DisconnectSafety =
  | 'NEVER_CONNECTED'
  | 'SAFE_SHUTDOWN_CONFIRMED'
  | 'CLOSED_DURING_IDLE_UNVERIFIED'
  | 'CLOSED_DURING_ACTIVE_OPERATION'
  | 'TRANSPORT_LOST_DURING_ACTIVE_OPERATION'
  | 'APP_EXIT_DURING_ACTIVE_OPERATION';

/** T2-11 active-operation kind. */
export type ActiveOperationKind =
  | 'idle'
  | 'job'
  | 'testFire'
  | 'frameDot'
  | 'frameSafe'
  | 'autoFocus'
  | 'jog';

export interface ActiveOperation {
  kind: ActiveOperationKind;
  sessionId?: number;
  ticketId?: string;
}

/**
 * The 16-state canonical safety union. Every state carries the
 * minimum metadata the UI / audit log needs at THAT state — keeping
 * fields per-kind avoids the "always-optional everywhere" problem
 * the scattered model had.
 */
export type MachineSafetyState =
  | { kind: 'DISCONNECTED_UNKNOWN' }
  | { kind: 'DISCONNECTED_SAFE' }
  | { kind: 'DISCONNECTED_UNSAFE'; reason: DisconnectSafety }
  | { kind: 'CONNECTING' }
  | { kind: 'CONNECTED_UNKNOWN' }
  | { kind: 'SAFETY_PROBING' }
  | { kind: 'IDLE_SAFE' }
  | { kind: 'IDLE_UNKNOWN' }
  | { kind: 'RUNNING_JOB'; ticketId?: string; sessionId?: number }
  | { kind: 'RUNNING_TEMP_LASER'; operation: 'testFire' | 'frameDot' | 'frameSafe' | 'autoFocus' | 'jog' }
  | { kind: 'HOLD_UNKNOWN' }
  | { kind: 'HOLD_SAFE' }
  | { kind: 'STOPPING' }
  | { kind: 'EMERGENCY_STOPPING' }
  | { kind: 'ALARM_UNKNOWN'; alarmCode: number }
  | { kind: 'FAULTED_REQUIRES_INSPECTION'; errorCode: number; cause: string }
  | { kind: 'UNSAFE_UNKNOWN'; reason: string };

export type MachineSafetyStateKind = MachineSafetyState['kind'];

/**
 * Inputs the canonical state derives from. Each field is one of the
 * scattered fields T1-22/24/25/29/30 + T2-11 introduced — the
 * derivation is pure.
 */
export interface SafetyStateInputs {
  /** True when the controller transport is open. */
  connected: boolean;
  /** GRBL status string from the most recent `<...>` report. */
  controllerStatus: ControllerStatus;
  /** T1-22 laser-output state. */
  laserOutput: LaserOutputState;
  /** T2-11 active operation. */
  activeOperation: ActiveOperation;
  /** True during the connect handshake — between port open and first IDLE confirmation. */
  isConnecting: boolean;
  /** True during T1-25's safety probe phase right after connect. */
  isSafetyProbing: boolean;
  /** True when the user pressed Stop and we're waiting for IDLE. */
  isStopping: boolean;
  /** True during emergency-stop in flight. */
  isEmergencyStopping: boolean;
  /** Set when a fault has been reported and recovery is required. */
  fault: { errorCode: number; cause: string } | null;
  /** Set when an alarm came in but the cause is unknown. */
  alarmCode: number | null;
  /** Set when disconnect was unsafe (T1-29). Drives the next-connect dialog. */
  disconnectSafety: DisconnectSafety;
}

/**
 * Pure derivation. Order matters — earliest match wins. The
 * function is the single source of truth for "what state is the
 * machine in?"; UI gates and the safety service consume the
 * returned discriminated value.
 */
export function computeMachineSafetyState(inputs: SafetyStateInputs): MachineSafetyState {
  // ── Connect-flow states ───────────────────────────────────
  if (!inputs.connected) {
    if (inputs.disconnectSafety === 'NEVER_CONNECTED') {
      return { kind: 'DISCONNECTED_UNKNOWN' };
    }
    if (inputs.disconnectSafety === 'SAFE_SHUTDOWN_CONFIRMED') {
      return { kind: 'DISCONNECTED_SAFE' };
    }
    return { kind: 'DISCONNECTED_UNSAFE', reason: inputs.disconnectSafety };
  }
  if (inputs.isConnecting) return { kind: 'CONNECTING' };
  if (inputs.isSafetyProbing) return { kind: 'SAFETY_PROBING' };

  // ── Active-fault states ───────────────────────────────────
  if (inputs.fault != null) {
    return {
      kind: 'FAULTED_REQUIRES_INSPECTION',
      errorCode: inputs.fault.errorCode,
      cause: inputs.fault.cause,
    };
  }
  if (inputs.alarmCode != null) {
    return { kind: 'ALARM_UNKNOWN', alarmCode: inputs.alarmCode };
  }

  // ── Stopping in flight ────────────────────────────────────
  if (inputs.isEmergencyStopping) return { kind: 'EMERGENCY_STOPPING' };
  if (inputs.isStopping) return { kind: 'STOPPING' };

  // ── Hold ──────────────────────────────────────────────────
  if (inputs.controllerStatus === 'hold' || inputs.controllerStatus === 'door') {
    if (inputs.laserOutput === 'OFF_CONFIRMED') return { kind: 'HOLD_SAFE' };
    return { kind: 'HOLD_UNKNOWN' };
  }

  // ── Running ───────────────────────────────────────────────
  if (inputs.activeOperation.kind === 'job'
      || inputs.controllerStatus === 'run') {
    return {
      kind: 'RUNNING_JOB',
      ticketId: inputs.activeOperation.ticketId,
      sessionId: inputs.activeOperation.sessionId,
    };
  }
  if (inputs.activeOperation.kind === 'testFire'
      || inputs.activeOperation.kind === 'frameDot'
      || inputs.activeOperation.kind === 'frameSafe'
      || inputs.activeOperation.kind === 'autoFocus'
      || inputs.activeOperation.kind === 'jog') {
    return { kind: 'RUNNING_TEMP_LASER', operation: inputs.activeOperation.kind };
  }

  // ── Idle ──────────────────────────────────────────────────
  if (inputs.controllerStatus === 'idle' && inputs.laserOutput === 'OFF_CONFIRMED') {
    return { kind: 'IDLE_SAFE' };
  }
  if (inputs.controllerStatus === 'idle') {
    return { kind: 'IDLE_UNKNOWN' };
  }

  // Catch-all: connected but in a state we can't safely classify
  return { kind: 'CONNECTED_UNKNOWN' };
}

/**
 * Predicate the start-job gate consults: is the machine in a state
 * where commanding it to start a job is safe?
 *
 * Only `IDLE_SAFE` qualifies. `IDLE_UNKNOWN` is rejected because
 * the user must run a safety probe first; `RUNNING_*` states are
 * obviously rejected; `HOLD_*` states are rejected because resume,
 * not start, is the right command.
 */
export function safetyStateAllowsStartJob(state: MachineSafetyState): boolean {
  return state.kind === 'IDLE_SAFE';
}

/**
 * Predicate the e-stop gate consults: is the machine in a state
 * where e-stop is meaningful? Anything but DISCONNECTED_*. (Even
 * if the controller is in a non-running state, e-stop is the
 * universal "go safe NOW" command.)
 */
export function safetyStateAllowsEmergencyStop(state: MachineSafetyState): boolean {
  return state.kind !== 'DISCONNECTED_UNKNOWN'
    && state.kind !== 'DISCONNECTED_SAFE'
    && state.kind !== 'DISCONNECTED_UNSAFE';
}

/**
 * Predicate the resume gate consults: is the machine in a state
 * where Resume can put it back into RUNNING_JOB?
 *
 * Only `HOLD_*` states qualify. After alarm or fault, the recovery
 * path is clear-alarm + re-home, not resume.
 */
export function safetyStateAllowsResume(state: MachineSafetyState): boolean {
  return state.kind === 'HOLD_SAFE' || state.kind === 'HOLD_UNKNOWN';
}

/**
 * The pre-job-start gate: which states require operator inspection
 * before the next motion is allowed?
 */
export function safetyStateRequiresInspection(state: MachineSafetyState): boolean {
  return state.kind === 'FAULTED_REQUIRES_INSPECTION'
    || state.kind === 'UNSAFE_UNKNOWN'
    || (state.kind === 'DISCONNECTED_UNSAFE'
        && (state.reason === 'CLOSED_DURING_ACTIVE_OPERATION'
            || state.reason === 'TRANSPORT_LOST_DURING_ACTIVE_OPERATION'
            || state.reason === 'APP_EXIT_DURING_ACTIVE_OPERATION'));
}

/** User-facing label for each kind. */
export function safetyStateLabel(state: MachineSafetyState): string {
  switch (state.kind) {
    case 'DISCONNECTED_UNKNOWN': return 'Disconnected';
    case 'DISCONNECTED_SAFE': return 'Disconnected (safe shutdown)';
    case 'DISCONNECTED_UNSAFE': return `Disconnected (unsafe: ${state.reason})`;
    case 'CONNECTING': return 'Connecting…';
    case 'CONNECTED_UNKNOWN': return 'Connected (state unknown)';
    case 'SAFETY_PROBING': return 'Verifying safety…';
    case 'IDLE_SAFE': return 'Idle';
    case 'IDLE_UNKNOWN': return 'Idle (laser state unverified)';
    case 'RUNNING_JOB': return 'Running job';
    case 'RUNNING_TEMP_LASER': return `Running ${state.operation}`;
    case 'HOLD_UNKNOWN': return 'Held (laser state unverified)';
    case 'HOLD_SAFE': return 'Held (laser off)';
    case 'STOPPING': return 'Stopping…';
    case 'EMERGENCY_STOPPING': return 'Emergency-stopping…';
    case 'ALARM_UNKNOWN': return `Alarm ${state.alarmCode}`;
    case 'FAULTED_REQUIRES_INSPECTION':
      return `Fault ${state.errorCode}: ${state.cause} — inspection required`;
    case 'UNSAFE_UNKNOWN': return `Unsafe: ${state.reason}`;
  }
}

/**
 * T2-57: typed error state per domain — `compile.error`,
 * `connection.error`, `job.error`, `machine.alarm`. Pre-T2-57
 * errors were `console.warn` / `appendMessage` / `showAlert` —
 * textual logs in a flat messages array. No code could ask "is
 * the connection currently in a failed state?" or "is there a
 * compile error blocking start?". Audit 4A Error-state findings.
 *
 * Concrete failure: connection fails, `appendMessage` appends to
 * messages. User clicks Start anyway — no `connection.error` to
 * gate on, and `machineState.status === 'disconnected'` is the same
 * value as "never connected" or "user disconnected manually."
 * Different error semantics, same observable state.
 *
 * T2-57 ships the typed error union per domain + a single-source-of-
 * truth `DomainErrorState` record + per-domain reducer transitions.
 * Wiring the reducer into MachineService / PipelineService /
 * useControllerConnection is filed as T2-57-followup so each error
 * site gets its retryable flag reviewed individually.
 *
 * The flat `messages` array remains for the user-facing console
 * timeline; T2-57's typed errors become the SOURCE OF TRUTH for
 * gating logic ("is start enabled?" / "should we surface a retry
 * banner?").
 */

// ─── per-domain error variants ────────────────────────────

export type CompileErrorKind =
  | 'profile-mismatch' | 'no-objects' | 'invalid-output-format'
  | 'pipeline-error' | 'fingerprint-stale' | 'gcode-template-invalid';

export interface CompileError {
  kind: CompileErrorKind;
  message: string;
  retryable: boolean;
  occurredAt: number;
}

export type ConnectionErrorKind =
  | 'permission-denied' | 'open-failed' | 'handshake-timeout'
  | 'cable-pulled' | 'baud-mismatch' | 'unsafe-prior-state'
  | 'unknown';

export interface ConnectionError {
  kind: ConnectionErrorKind;
  message: string;
  retryable: boolean;
  occurredAt: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed';

export type JobErrorKind =
  | 'precondition-failed' | 'controller-rejected' | 'streaming-error'
  | 'firmware-alarm' | 'user-stopped' | 'fingerprint-mismatch'
  | 'unknown';

export interface JobError {
  kind: JobErrorKind;
  message: string;
  alarmCode?: number;
  errorCode?: number;
  occurredAt: number;
}

export interface MachineAlarm {
  code: number;
  message: string;
  occurredAt: number;
}

/**
 * Single-source-of-truth error state. Each domain has at most one
 * active error at a time (most-recent wins per domain). Connection
 * carries its status separately because "disconnected without an
 * error" (user-initiated) is a real state distinct from "failed."
 */
export interface DomainErrorState {
  compile: { error: CompileError | null };
  connection: { status: ConnectionStatus; error: ConnectionError | null };
  job: { error: JobError | null };
  machine: { alarm: MachineAlarm | null };
}

export const initialDomainErrorState: DomainErrorState = {
  compile: { error: null },
  connection: { status: 'disconnected', error: null },
  job: { error: null },
  machine: { alarm: null },
};

// ─── transitions ──────────────────────────────────────────

export function setCompileError(
  state: DomainErrorState,
  error: CompileError | null,
): DomainErrorState {
  return { ...state, compile: { error } };
}

export function clearCompileError(state: DomainErrorState): DomainErrorState {
  return setCompileError(state, null);
}

export function setConnectionStatus(
  state: DomainErrorState,
  status: ConnectionStatus,
): DomainErrorState {
  // Successful reconnect clears the error.
  const clearError = status === 'connected' || status === 'connecting';
  return {
    ...state,
    connection: {
      status,
      error: clearError ? null : state.connection.error,
    },
  };
}

export function setConnectionError(
  state: DomainErrorState,
  error: ConnectionError | null,
): DomainErrorState {
  return {
    ...state,
    connection: {
      // Setting an error implies the failed status; null leaves status alone.
      status: error == null ? state.connection.status : 'failed',
      error,
    },
  };
}

export function setJobError(
  state: DomainErrorState,
  error: JobError | null,
): DomainErrorState {
  return { ...state, job: { error } };
}

export function clearJobError(state: DomainErrorState): DomainErrorState {
  return setJobError(state, null);
}

export function setMachineAlarm(
  state: DomainErrorState,
  alarm: MachineAlarm | null,
): DomainErrorState {
  return { ...state, machine: { alarm } };
}

export function clearMachineAlarm(state: DomainErrorState): DomainErrorState {
  return setMachineAlarm(state, null);
}

/** Reset everything to the initial state — used by "new project" / "reset all". */
export function resetDomainErrorState(): DomainErrorState {
  return initialDomainErrorState;
}

// ─── selectors / gates ────────────────────────────────────

export function selectHasAnyError(state: DomainErrorState): boolean {
  return state.compile.error !== null
    || state.connection.error !== null
    || state.job.error !== null
    || state.machine.alarm !== null;
}

/**
 * The start-job gate. Compile + connection + machine must all be
 * clean. Job error doesn't block a NEW job (it describes the LAST
 * one) — but a stale job error implies you should clear it before
 * starting another, so callers may opt to gate on it too.
 */
export function selectCanStartJob(state: DomainErrorState): boolean {
  return state.compile.error === null
    && state.connection.error === null
    && state.connection.status === 'connected'
    && state.machine.alarm === null;
}

export function selectCanConnect(state: DomainErrorState): boolean {
  // If an error is non-retryable (e.g. permission-denied without
  // user re-authorisation), gate the button until cleared.
  return state.connection.error === null || state.connection.error.retryable === true;
}

export function selectCanRetryCompile(state: DomainErrorState): boolean {
  return state.compile.error === null || state.compile.error.retryable === true;
}

/**
 * Format a domain error for the user-facing console timeline. Used
 * during T2-57-followup migration: the existing `appendMessage`
 * site produces the timeline message from the typed error rather
 * than from a free-form string.
 */
export function describeError(
  e: CompileError | ConnectionError | JobError | MachineAlarm,
): string {
  if ('kind' in e) {
    return `[${e.kind}] ${e.message}`;
  }
  return `[alarm:${e.code}] ${e.message}`;
}

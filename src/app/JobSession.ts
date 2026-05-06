/**
 * T2-53: `JobPhase` state machine. Pre-T2-53 "is the job running?"
 * was answered by 6 different authorities that could disagree:
 *   - `grbl.isJobRunning`
 *   - `controllerRef.current?.isJobRunning`
 *   - `machineState?.status === 'hold'` (read as paused)
 *   - `isPaused` (local UI state, optimistic)
 *   - `displayPaused` (derived: isPaused || machineState.status === 'hold')
 *   - `jobStoppedByUserRef`
 *
 * Audit 4A Finding 2 + Duplication 4 + Critical Failure 4 +
 * Required Fix 5. The classic failure: pause() command fails
 * silently, the controller is still running, but the UI optimistically
 * set `isPaused = true` so the operator sees "paused" while the
 * machine moves.
 *
 * T2-53 ships the canonical `JobPhase` union + the transition
 * function that consumes T2-41's `SafetyActionResult` (so phase
 * never optimistically advances) + selectors. Wiring the canonical
 * phase into ConnectionPanelMain (removing local isPaused +
 * displayPaused + jobStoppedByUserRef) is filed as T2-53-followup.
 *
 * Pairs with T2-44 (safety state machine) — both consume
 * SafetyActionResult; T2-44 owns SAFETY states (alarm /
 * unsafeUnknown / requiresInspection), T2-53 owns JOB phases
 * (starting / running / paused / stopping).
 */

/**
 * Per-tick progress. The shape mirrors T2-7's controller-agnostic
 * subset of JobProgress; T2-53 only consumes percent / linesDone /
 * elapsedMs so non-GRBL controllers can push their own progress.
 */
export interface JobProgressLike {
  percent: number;
  linesDone: number;
  linesTotal: number;
  elapsedMs: number;
}

export type PauseReason = 'user' | 'firmware' | 'door';
export type StopReason = 'user' | 'error' | 'completion';

export interface JobError {
  message: string;
  alarmCode?: number;
  errorCode?: number;
}

/**
 * The 7 phases of a job session. Order is enforced by the
 * transition functions; the type itself is open. Each carries the
 * minimum metadata UI needs at THAT phase.
 */
export type JobPhase =
  | { phase: 'idle' }
  | { phase: 'starting'; ticketId: string; startedAt: number }
  | { phase: 'running'; ticketId: string; startedAt: number; progress: JobProgressLike }
  | {
      phase: 'paused';
      ticketId: string;
      startedAt: number;
      pausedAt: number;
      reason: PauseReason;
    }
  | { phase: 'stopping'; ticketId: string; reason: StopReason }
  | {
      phase: 'completed';
      ticketId: string;
      startedAt: number;
      completedAt: number;
    }
  | { phase: 'failed'; ticketId: string; error: JobError };

export type JobPhaseKind = JobPhase['phase'];

export const jobPhaseInitial: JobPhase = { phase: 'idle' };

/**
 * Subset of T2-41's SafetyActionResult that the transition functions
 * consume. Re-declared so this module compiles independently.
 */
export interface SafetyResultLike {
  action: 'pause' | 'resume' | 'stop' | 'emergencyStop' | 'laserOff' | 'disconnectSafe' | 'beginTestFire' | 'endTestFire';
  accepted: boolean;
  message?: string;
}

// ─── selectors ─────────────────────────────────────────────

export function selectIsRunning(p: JobPhase): boolean {
  return p.phase === 'running';
}

export function selectIsPaused(p: JobPhase): boolean {
  return p.phase === 'paused';
}

export function selectIsStopping(p: JobPhase): boolean {
  return p.phase === 'stopping';
}

export function selectIsActive(p: JobPhase): boolean {
  return p.phase === 'starting' || p.phase === 'running'
    || p.phase === 'paused' || p.phase === 'stopping';
}

export function selectTicketId(p: JobPhase): string | null {
  switch (p.phase) {
    case 'starting': case 'running': case 'paused':
    case 'stopping': case 'completed': case 'failed':
      return p.ticketId;
    case 'idle':
      return null;
  }
}

export function selectProgress(p: JobPhase): JobProgressLike | null {
  return p.phase === 'running' ? p.progress : null;
}

export function selectError(p: JobPhase): JobError | null {
  return p.phase === 'failed' ? p.error : null;
}

// ─── transitions ───────────────────────────────────────────

/** Operator clicked "Start". The controller hasn't ack'd yet. */
export function onJobStartRequested(args: {
  current: JobPhase;
  ticketId: string;
  now: number;
}): JobPhase {
  // Only valid from idle, completed, or failed.
  if (args.current.phase !== 'idle'
      && args.current.phase !== 'completed'
      && args.current.phase !== 'failed') {
    return args.current;
  }
  return { phase: 'starting', ticketId: args.ticketId, startedAt: args.now };
}

/**
 * Controller reports the job is running. Transitions starting →
 * running, or updates running → running (progress tick).
 */
export function onControllerJobRunning(args: {
  current: JobPhase;
  progress: JobProgressLike;
}): JobPhase {
  if (args.current.phase === 'starting') {
    return {
      phase: 'running',
      ticketId: args.current.ticketId,
      startedAt: args.current.startedAt,
      progress: args.progress,
    };
  }
  if (args.current.phase === 'running') {
    return { ...args.current, progress: args.progress };
  }
  // From paused → running is handled by onResumeResult; refuse here.
  return args.current;
}

/**
 * Pause command result (T2-41). Phase advances to `paused` ONLY
 * when accepted=true. The classic failure mode (UI shows paused
 * while machine is still running) is structurally impossible: a
 * refused pause leaves the phase as `running`.
 */
export function onPauseResult(args: {
  current: JobPhase;
  result: SafetyResultLike;
  reason: PauseReason;
  now: number;
}): JobPhase {
  if (args.result.action !== 'pause') return args.current;
  if (!args.result.accepted) {
    // Pause refused → phase unchanged (no optimistic 'paused' transition).
    return args.current;
  }
  if (args.current.phase !== 'running') return args.current;
  return {
    phase: 'paused',
    ticketId: args.current.ticketId,
    startedAt: args.current.startedAt,
    pausedAt: args.now,
    reason: args.reason,
  };
}

/**
 * Controller reports it has entered hold/door state without our
 * pause command (firmware-initiated pause — door interlock, runtime
 * pause via realtime byte, etc.). Transition only when running.
 */
export function onControllerHold(args: {
  current: JobPhase;
  reason: PauseReason;
  now: number;
}): JobPhase {
  if (args.current.phase !== 'running') return args.current;
  return {
    phase: 'paused',
    ticketId: args.current.ticketId,
    startedAt: args.current.startedAt,
    pausedAt: args.now,
    reason: args.reason,
  };
}

/**
 * Resume command result. Phase advances back to `running` ONLY
 * when accepted=true.
 */
export function onResumeResult(args: {
  current: JobPhase;
  result: SafetyResultLike;
}): JobPhase {
  if (args.result.action !== 'resume') return args.current;
  if (!args.result.accepted) return args.current;
  if (args.current.phase !== 'paused') return args.current;
  return {
    phase: 'running',
    ticketId: args.current.ticketId,
    startedAt: args.current.startedAt,
    progress: { percent: 0, linesDone: 0, linesTotal: 0, elapsedMs: 0 },
  };
}

/**
 * Stop requested. Transitions running/paused/starting → stopping.
 * The stopping → completed/failed transition is driven by the
 * controller's onComplete or onFailed callback.
 */
export function onStopRequested(args: {
  current: JobPhase;
  reason: StopReason;
}): JobPhase {
  if (args.current.phase !== 'running'
      && args.current.phase !== 'paused'
      && args.current.phase !== 'starting') {
    return args.current;
  }
  return { phase: 'stopping', ticketId: args.current.ticketId, reason: args.reason };
}

/** Job completed cleanly. */
export function onJobCompleted(args: {
  current: JobPhase;
  now: number;
}): JobPhase {
  if (args.current.phase !== 'running'
      && args.current.phase !== 'stopping'
      && args.current.phase !== 'paused') {
    return args.current;
  }
  // Take startedAt from the active phase (running/paused) or from
  // the stopping ticketId-only state. For 'stopping', startedAt is
  // not stored in the phase variant; default to `now` (caller
  // typically supplies the original startedAt via a wrapper).
  const startedAt = args.current.phase === 'running' || args.current.phase === 'paused'
    ? args.current.startedAt
    : args.now;
  return {
    phase: 'completed',
    ticketId: args.current.ticketId,
    startedAt,
    completedAt: args.now,
  };
}

/** Job failed (alarm during run, controller disconnect mid-run, stream error). */
export function onJobFailed(args: {
  current: JobPhase;
  error: JobError;
}): JobPhase {
  if (args.current.phase === 'idle' || args.current.phase === 'completed') {
    return args.current;
  }
  return {
    phase: 'failed',
    ticketId: selectTicketId(args.current) ?? '',
    error: args.error,
  };
}

/** Reset to idle — used for "Clear last job" / "Acknowledge failure". */
export function clearJobPhase(): JobPhase {
  return { phase: 'idle' };
}

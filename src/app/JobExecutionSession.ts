/**
 * T2-45: JobExecutionSession with safety methods on the session
 * handle. Pre-T2-45 the streaming API is `sendJob(lines: string[])`
 * with `void`-returning pause/stop on `MachineService` /
 * `GrblController`. For controllers where pause/stop semantics
 * belong to a native job handle (Ruida file jobs, Wi-Fi cloud jobs)
 * the host-side methods can't reach into the controller's internal
 * job tracking — there's no per-job session to act on.
 *
 * Audit 3D Required P1 + Critical 7. T2-27 introduces
 * `executeJob(output: ControllerOutput)` returning `JobHandle`;
 * T2-45 extends `JobHandle` into a full session with safety
 * methods scoped to the session.
 *
 * T2-45 ships the type/interface layer + the typed completion
 * result + a session-event listener primitive. Wiring
 * `MachineService.startValidatedJob` to return one and migrating
 * UI buttons to act on the session is filed as T2-45-followup.
 *
 * Pairs with T2-42 (ControllerSafetyOps): the session's pause /
 * resume / abort methods take their typed result shape from T2-41
 * SafetyActionResult.
 */

import type { SafetyActionResult } from './SafetyActionResult';
import type { SafetyUrgency } from '../controllers/ControllerSafetyOps';
import type { Unsubscribe } from '../communication/TransportSubscription';

/** Discriminator for how the controller models job execution. */
export type JobExecutionModel = 'lineStream' | 'uploadedFile' | 'nativeJob';

/** Live job progress snapshot. */
export interface JobProgress {
  /** Lines / segments / bytes completed. Unit depends on executionModel. */
  readonly completed: number;
  /** Total units when known; null for streamed-with-no-precount. */
  readonly total: number | null;
  /** Percent in [0, 1]; computed when both fields known. */
  readonly percent: number;
  /** Wall-clock seconds since job start. */
  readonly elapsedSec: number;
}

/** Discriminator for how a job ended. */
export type JobCompletionKind =
  | 'success'
  | 'aborted-by-user'
  | 'aborted-emergency'
  | 'controller-error'
  | 'transport-error'
  | 'paused-discarded'  // user paused then chose not to resume
  | 'unknown';

/** Typed completion result emitted on session end. */
export interface JobCompletionResult {
  readonly jobId: string;
  readonly kind: JobCompletionKind;
  readonly progress: JobProgress;
  readonly safetyResult?: SafetyActionResult;
  readonly errorMessage?: string;
  readonly endedAt: number;
}

/**
 * Lifecycle state of a session. Pure observation surface so the
 * UI doesn't need to crosscheck `progress.percent === 1` vs
 * `controller.status` to know whether the session is over.
 */
export type JobSessionStatus =
  | 'starting'
  | 'running'
  | 'pauseRequested'
  | 'paused'
  | 'abortRequested'
  | 'finished';

/**
 * Job execution session. The replacement for `void sendJob(lines)`
 * + scattered `controller.pause()` / `controller.stop()` calls.
 *
 * Implementations MUST satisfy:
 * - `pause()` / `resume()` / `abort()` are idempotent in a tight
 *   sense: calling pause while already paused returns
 *   `{ accepted: true, ... }` without re-issuing the controller
 *   command (no double feed-hold).
 * - `getProgress()` is synchronous and cheap — UI hot paths read
 *   it on every animation frame.
 * - The session's `onComplete` listener is invoked exactly ONCE
 *   per session lifetime, even if multiple completion sources
 *   fire (controller idle + transport close + abort), per audit
 *   3D's "exactly-once completion" requirement.
 */
export interface JobExecutionSession {
  readonly jobId: string;
  /** Snake-cased controller-family identifier (T2-29). */
  readonly controllerFamily: string;
  readonly executionModel: JobExecutionModel;
  readonly startedAt: number;

  getStatus(): JobSessionStatus;
  getProgress(): JobProgress;

  pause(): Promise<SafetyActionResult>;
  resume(): Promise<SafetyActionResult>;
  abort(urgency: SafetyUrgency): Promise<SafetyActionResult>;

  onProgress(cb: (p: JobProgress) => void): Unsubscribe;
  onStatus(cb: (s: JobSessionStatus) => void): Unsubscribe;
  onComplete(cb: (result: JobCompletionResult) => void): Unsubscribe;
}

/** Empty progress baseline — use as the initial value before the first tick. */
export const ZERO_PROGRESS: JobProgress = {
  completed: 0,
  total: null,
  percent: 0,
  elapsedSec: 0,
};

/** Build a JobProgress, computing `percent` from completed/total when possible. */
export function buildJobProgress(opts: {
  completed: number;
  total: number | null;
  elapsedSec: number;
}): JobProgress {
  const percent = opts.total != null && opts.total > 0
    ? Math.min(1, Math.max(0, opts.completed / opts.total))
    : 0;
  return {
    completed: opts.completed,
    total: opts.total,
    percent,
    elapsedSec: opts.elapsedSec,
  };
}

/**
 * Build a typed JobCompletionResult. Helper because the field set
 * is wide and adopters keep the call sites tidy this way.
 */
export function buildJobCompletion(opts: {
  jobId: string;
  kind: JobCompletionKind;
  progress: JobProgress;
  safetyResult?: SafetyActionResult;
  errorMessage?: string;
  endedAt: number;
}): JobCompletionResult {
  return {
    jobId: opts.jobId,
    kind: opts.kind,
    progress: opts.progress,
    safetyResult: opts.safetyResult,
    errorMessage: opts.errorMessage,
    endedAt: opts.endedAt,
  };
}

/** Predicate: status maps to "session is over". */
export function isSessionFinished(status: JobSessionStatus): boolean {
  return status === 'finished';
}

/** Predicate: status maps to "user CAN press pause". */
export function canPauseFromStatus(status: JobSessionStatus): boolean {
  return status === 'running';
}

/** Predicate: status maps to "user CAN press resume". */
export function canResumeFromStatus(status: JobSessionStatus): boolean {
  return status === 'paused';
}

/** Predicate: status maps to "user CAN abort". Always true except finished. */
export function canAbortFromStatus(status: JobSessionStatus): boolean {
  return status !== 'finished';
}

/** User-facing label per session status. */
export function jobSessionStatusLabel(status: JobSessionStatus): string {
  switch (status) {
    case 'starting':        return 'Starting…';
    case 'running':         return 'Running';
    case 'pauseRequested':  return 'Pausing…';
    case 'paused':          return 'Paused';
    case 'abortRequested':  return 'Aborting…';
    case 'finished':        return 'Finished';
  }
}

/** User-facing label per completion kind. */
export function jobCompletionLabel(kind: JobCompletionKind): string {
  switch (kind) {
    case 'success':           return 'Job completed.';
    case 'aborted-by-user':   return 'Job aborted by user.';
    case 'aborted-emergency': return 'Job aborted (emergency).';
    case 'controller-error':  return 'Job failed (controller error).';
    case 'transport-error':   return 'Job failed (connection lost).';
    case 'paused-discarded':  return 'Paused job discarded.';
    case 'unknown':           return 'Job ended (unknown reason).';
  }
}

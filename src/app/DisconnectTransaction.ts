/**
 * T2-54: unified disconnect transaction. Pre-T2-54 disconnect was
 * implemented in 7+ places with inconsistent cleanup —
 * `useControllerConnection.disconnect:49`, `ConnectionPanel.
 * handleDisconnect:62`, `ConnectionPanelMain.handleDisconnect:557`,
 * `ConnectionPanelMain` line 1805, `App.handleToolbarDisconnect:
 * 1257`, `App` line 946, `ExecutionCoordinator.safeDisconnect:214`.
 * Each path did some subset of stop / laser-off / controller.
 * disconnect / machineService.disconnect / port cleanup / message
 * clearing / panel closing. A user pressing the toolbar disconnect
 * button got different cleanup than one pressing the panel
 * disconnect button which differed again from beforeunload.
 *
 * Concrete failure: toolbar disconnect during a running job used
 * `safeDisconnect({ skipStop: true })` (line 1259) — skipping stop
 * while running could leave the machine moving.
 *
 * Audit 4A Reset/Cleanup section + Required Fix.
 *
 * T2-54 ships the transaction shape (typed reason + stop policy +
 * result + ordered step plan) + a pure transaction-runner that
 * calls injected step implementations in order and aggregates
 * results. Wiring to MachineService / replacing the 7 call sites is
 * filed as T2-54-followup.
 */

import type {
  SafetyActionResult,
} from './SafetyActionResult';

export type DisconnectReason =
  | 'toolbar'
  | 'panel'
  | 'beforeunload'
  | 'error'
  | 'profile-switch';

export type StopPolicy = 'stop-if-running' | 'skip-stop' | 'emergency-stop';

export interface DisconnectOptions {
  readonly reason: DisconnectReason;
  readonly stopPolicy: StopPolicy;
}

export interface DisconnectResult {
  readonly reason: DisconnectReason;
  readonly stopPolicy: StopPolicy;
  /** True if a job was running and the stop step was attempted (any outcome). */
  readonly stopAttempted: boolean;
  /** True iff stop attempt's SafetyActionResult.accepted = true. */
  readonly jobAborted: boolean;
  readonly laserOffSent: boolean;
  /** Tristate per T2-41 — `unknown` on controllers without per-byte ack. */
  readonly laserOffVerified: boolean | 'unknown';
  readonly portClosed: boolean;
  readonly errors: readonly Error[];
}

/** Step plan computed up front so the test surface can pin ordering. */
export type DisconnectStep =
  | 'stop'
  | 'emergency-stop'
  | 'laser-off'
  | 'close-transport'
  | 'clear-session';

/**
 * Pure planner: maps options + isJobRunning to the ordered step
 * list. Audit-derived rule:
 *   - emergency-stop policy → e-stop step (regardless of running)
 *   - stop-if-running + isRunning → stop step
 *   - skip-stop OR not-running → no stop step
 *   - laser-off + close-transport + clear-session always run
 */
export function planDisconnectSteps(opts: {
  options: DisconnectOptions;
  isJobRunning: boolean;
}): DisconnectStep[] {
  const steps: DisconnectStep[] = [];
  switch (opts.options.stopPolicy) {
    case 'emergency-stop':
      steps.push('emergency-stop');
      break;
    case 'stop-if-running':
      if (opts.isJobRunning) steps.push('stop');
      break;
    case 'skip-stop':
      // no stop step
      break;
  }
  steps.push('laser-off');
  steps.push('close-transport');
  steps.push('clear-session');
  return steps;
}

/**
 * Step adapter — caller supplies one of these. The transaction
 * runner invokes them in plan order. Each adapter is independent;
 * an exception in one adapter is caught and recorded in
 * `result.errors`, the rest still run.
 */
export interface DisconnectAdapters {
  isJobRunning(): boolean;
  abortJob?(): Promise<SafetyActionResult>;
  emergencyStop?(): Promise<SafetyActionResult>;
  laserOff(): Promise<SafetyActionResult>;
  closeTransport(): Promise<void>;
  clearSession(): void;
}

/**
 * Pure transaction runner. Computes the step plan, dispatches to
 * adapters in order, aggregates results into a typed
 * `DisconnectResult`. Returns even when some steps fail — the
 * caller learns what succeeded and what didn't.
 */
export async function runDisconnectTransaction(
  options: DisconnectOptions,
  adapters: DisconnectAdapters,
): Promise<DisconnectResult> {
  const isRunning = adapters.isJobRunning();
  const steps = planDisconnectSteps({ options, isJobRunning: isRunning });
  const errors: Error[] = [];
  let stopAttempted = false;
  let jobAborted = false;
  let laserOffSent = false;
  let laserOffVerified: boolean | 'unknown' = 'unknown';
  let portClosed = false;

  for (const step of steps) {
    try {
      switch (step) {
        case 'stop': {
          stopAttempted = true;
          if (adapters.abortJob == null) {
            errors.push(new Error('stop: abortJob adapter missing'));
            break;
          }
          const r = await adapters.abortJob();
          jobAborted = r.accepted;
          break;
        }
        case 'emergency-stop': {
          stopAttempted = true;
          if (adapters.emergencyStop == null) {
            errors.push(new Error('emergency-stop: emergencyStop adapter missing'));
            break;
          }
          const r = await adapters.emergencyStop();
          jobAborted = r.accepted;
          break;
        }
        case 'laser-off': {
          const r = await adapters.laserOff();
          laserOffSent = true;
          laserOffVerified =
            r.laserState === 'off' ? true
            : r.laserState === 'commandedOff' ? 'unknown'
            : false;
          break;
        }
        case 'close-transport': {
          await adapters.closeTransport();
          portClosed = true;
          break;
        }
        case 'clear-session': {
          adapters.clearSession();
          break;
        }
      }
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return {
    reason: options.reason,
    stopPolicy: options.stopPolicy,
    stopAttempted,
    jobAborted,
    laserOffSent,
    laserOffVerified,
    portClosed,
    errors,
  };
}

/** Diagnostic: was the disconnect transaction fully clean? */
export function disconnectWasClean(result: DisconnectResult): boolean {
  return (
    result.errors.length === 0 &&
    result.laserOffSent &&
    result.portClosed
  );
}

/** User-facing summary line for the disconnect outcome. */
export function describeDisconnectResult(result: DisconnectResult): string {
  if (disconnectWasClean(result)) {
    return result.stopAttempted && result.jobAborted
      ? 'Disconnected. Job aborted and laser commanded off.'
      : 'Disconnected. Laser commanded off.';
  }
  const parts: string[] = ['Disconnect completed with issues:'];
  if (result.stopAttempted && !result.jobAborted) parts.push('stop refused');
  if (!result.laserOffSent) parts.push('laser-off not sent');
  if (!result.portClosed) parts.push('transport not closed');
  if (result.errors.length > 0) parts.push(`${result.errors.length} error(s)`);
  return parts.join(' / ');
}

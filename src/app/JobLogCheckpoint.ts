/**
 * T2-111: periodic JobLog checkpointing during running jobs.
 * Pre-T2-111 `MachineService.tryFinalizeJobLog` saved only on the
 * idle transition — if the renderer crashed, the app closed, or
 * the machine disconnected mid-job, the in-memory `currentJobLog`
 * was lost. The failed job's evidence vanished.
 *
 * Audit 5C Required Priority 7. T2-111 first shipped the scheduling
 * helper + the orphan detector; S25-10-001 wires the checkpointer into
 * `MachineService` so active jobs save running checkpoints before idle
 * finalization. Boot-time orphan finalization remains a separate
 * recovery/reporting concern.
 *
 * Pairs with T2-105 (crash-loop recovery) — the crash report
 * references the orphaned job log via correlation ID (T2-117); and
 * T2-112 (event-window retention) which compacts the entries array
 * before each checkpoint write.
 */

/**
 * Subset of T2-49 SchedulerLike that the checkpointer needs.
 * Re-declared locally so src/ does not depend on tests/. The
 * production wiring layer can pass a VirtualScheduler (tests) or
 * a setInterval-wrapper (production) — both satisfy this shape.
 */
export interface CheckpointSchedulerLike {
  setInterval(fn: () => void, ms: number): { id: number };
  clearInterval(handle: { id: number }): void;
}

/**
 * Minimal shape the checkpointer needs from a JobLog. The actual
 * production type lives at `src/core/job/JobLog.ts`; T2-111
 * declares the subset so this module compiles independently.
 */
export interface JobLogLike {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | string;
  entries: ReadonlyArray<unknown>;
  lastCheckpointAt?: number;
}

export interface CheckpointStorage {
  /** Write the log under its `.id` key. Overwrites prior checkpoint. */
  save(log: JobLogLike): Promise<void> | void;
  /** Read all stored job logs — used at boot for orphan detection. */
  list(): Promise<JobLogLike[]> | JobLogLike[];
}

export interface JobLogCheckpointerOptions {
  /** Interval between checkpoints. Default 10 000 ms (audit recommendation). */
  intervalMs: number;
  /**
   * When true, skip the write if `entries.length` hasn't grown since
   * the last checkpoint. Default true; set false for tests that
   * want to verify periodic writes.
   */
  skipIfNoGrowth: boolean;
  /** Override clock — defaults to `() => Date.now()`. */
  now: () => number;
}

export const DEFAULT_CHECKPOINTER_OPTIONS: JobLogCheckpointerOptions = {
  intervalMs: 10_000,
  skipIfNoGrowth: true,
  now: () => Date.now(),
};

/**
 * Periodic checkpointer. Inject a `SchedulerLike` (real or
 * `VirtualScheduler`) to make this testable without real timers.
 *
 * Lifecycle:
 *   - `start(getLog)` begins the timer. Caller supplies a
 *     getter so the checkpointer always reads the latest in-memory
 *     log at fire time (avoids stale-snapshot bugs).
 *   - On each fire, if the current log is `status: 'running'` and
 *     entries have grown (or skipIfNoGrowth=false), save with
 *     `lastCheckpointAt = now()`.
 *   - `stop()` clears the timer.
 *
 * Sink errors are swallowed — a broken storage layer should not
 * cause the running job to fail.
 */
export class JobLogCheckpointer {
  private timer: { id: number } | null = null;
  private lastEntriesLength = 0;
  private lastCheckpointAt = 0;
  private readonly options: JobLogCheckpointerOptions;

  constructor(
    private readonly scheduler: CheckpointSchedulerLike,
    private readonly storage: CheckpointStorage,
    options: Partial<JobLogCheckpointerOptions> = {},
  ) {
    this.options = { ...DEFAULT_CHECKPOINTER_OPTIONS, ...options };
  }

  start(getLog: () => JobLogLike | null): void {
    if (this.timer != null) return;
    this.lastEntriesLength = 0;
    this.timer = this.scheduler.setInterval(() => {
      const log = getLog();
      if (!log || log.status !== 'running') return;
      if (this.options.skipIfNoGrowth && log.entries.length === this.lastEntriesLength) {
        return;
      }
      const stamped: JobLogLike = {
        ...log,
        lastCheckpointAt: this.options.now(),
      };
      this.lastEntriesLength = log.entries.length;
      this.lastCheckpointAt = stamped.lastCheckpointAt as number;
      try {
        const result = this.storage.save(stamped);
        if (result instanceof Promise) {
          result.catch(() => { /* swallow */ });
        }
      } catch {
        /* swallow */
      }
    }, this.options.intervalMs);
  }

  stop(): void {
    if (this.timer != null) {
      this.scheduler.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test introspection. */
  get isRunning(): boolean { return this.timer != null; }

  /** Test introspection — the most-recent checkpoint stamp. */
  get checkpointStamp(): number { return this.lastCheckpointAt; }
}

/**
 * Boot-time orphan detector. Any stored log with `status: 'running'`
 * has a session that no longer exists — the app crashed before
 * reaching the idle transition. Returns the orphans for the caller
 * to finalize as `'unknown_interruption'` (T2-67 outcome).
 */
export function findOrphanedJobLogs(logs: JobLogLike[]): JobLogLike[] {
  return logs.filter((l) => l.status === 'running');
}

/**
 * Compose the finalization message that includes the last
 * checkpoint info — used by the orphan-finalize path so the user
 * sees "Job interrupted (crash) — at line N of M" rather than just
 * a generic 'unknown_interruption'.
 */
export interface OrphanFinalization {
  reason: 'unknown_interruption';
  message: string;
  finalizedAt: number;
}

export function buildOrphanFinalization(args: {
  log: JobLogLike;
  now: number;
  reachedLineCount?: number;
  totalLineCount?: number;
}): OrphanFinalization {
  const checkpointAge = args.log.lastCheckpointAt
    ? args.now - args.log.lastCheckpointAt
    : null;
  const ageStr = checkpointAge != null
    ? ` (${Math.floor(checkpointAge / 1000)}s ago)`
    : '';
  const lineStr = args.reachedLineCount != null && args.totalLineCount != null
    ? ` at line ${args.reachedLineCount} of ${args.totalLineCount}`
    : args.reachedLineCount != null
    ? ` at line ${args.reachedLineCount}`
    : '';
  return {
    reason: 'unknown_interruption',
    message: `Job interrupted (crash)${lineStr}. Last checkpoint${ageStr}.`,
    finalizedAt: args.now,
  };
}

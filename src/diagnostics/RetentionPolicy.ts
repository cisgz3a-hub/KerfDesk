/**
 * T3-87: per-domain retention policy with failed-job pinning.
 *
 * Pre-T3-87 retention is hard-coded — `MAX_RETAINED_LOGS = 5` for
 * `JobLog`, `MAX_RETAINED_REPLAYS = 20` for `JobReplay`, no domain
 * awareness, no failed-job pinning. Audit 5C Required Priority 12
 * called this out: a user troubleshooting a problem might run 5–10
 * test jobs in an hour and overwrite the original failed-job log
 * before they can inspect it. Support cannot ask for "the failed
 * log from yesterday" because it has been evicted.
 *
 * The audit's recommended policy:
 *
 *   - **Job summaries** (lightweight metadata): keep last 100.
 *   - **Detailed job logs** (full entries): keep last 10.
 *   - **Failed job logs**: pin for 30 days regardless of count cap.
 *   - **Crash reports**: keep last 20.
 *   - **RX/TX traces**: keep last failed + last successful (1 each).
 *
 * **This module is pure policy + selection helpers.** Wiring the
 * selectors into `JobLog.ts` / `JobReplay.ts` / crash-report storage
 * is filed as a future T3-87 follow-up slice. The current `MAX_RETAINED_LOGS`
 * and `MAX_RETAINED_REPLAYS` constants stay in place; production
 * behavior is unchanged. Same foundation-first pattern T3-43 / T3-44
 * / T3-46 / T3-50 / T3-51 used.
 */

/** Status discriminator that drives failed-job pinning. */
export type RetentionJobStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'failed_to_start'
  | 'stopped';

/** Minimal record shape every retention selector consumes. Generic
 *  over the actual log type; both `JobLog` and `JobReplay` satisfy
 *  this shape (they each carry `id`, `startedAt`, `status`). */
export interface RetentionRecord {
  readonly id: string;
  readonly startedAt: string;
  readonly status: RetentionJobStatus;
}

/**
 * Per-domain retention policy. Counts are upper bounds; failed-job
 * pinning extends retention by `failedAgeMs` past the count cap.
 * Pin-forever (`Infinity`) is supported for the strictest cases.
 */
export interface RetentionPolicy {
  readonly jobLogs: {
    /** Last N lightweight summaries by start time. */
    readonly summariesCount: number;
    /** Last N detailed logs (full entries) by start time. */
    readonly detailedCount: number;
    /** Failed/critical logs kept this many ms past the count caps. */
    readonly failedAgeMs: number;
  };
  readonly replays: {
    readonly count: number;
    readonly failedAgeMs: number;
  };
  readonly crashReports: {
    readonly count: number;
  };
  readonly rxTxTraces: {
    readonly lastFailed: number;
    readonly lastSuccessful: number;
  };
}

/** Default retention per audit 5C Required Priority 12. */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  jobLogs: {
    summariesCount: 100,
    detailedCount: 10,
    failedAgeMs: 30 * 24 * 60 * 60 * 1000,
  },
  replays: {
    count: 20,
    failedAgeMs: 30 * 24 * 60 * 60 * 1000,
  },
  crashReports: {
    count: 20,
  },
  rxTxTraces: {
    lastFailed: 1,
    lastSuccessful: 1,
  },
};

/** Failed-status set for pin-by-status logic. */
const FAILED_STATUSES: ReadonlySet<RetentionJobStatus> = new Set([
  'failed',
  'failed_to_start',
]);

function isFailedStatus(status: RetentionJobStatus): boolean {
  return FAILED_STATUSES.has(status);
}

function startedAtMs(record: RetentionRecord): number {
  const t = Date.parse(record.startedAt);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Sort by `startedAt` descending (newest first). Pure; does not
 * mutate the input array.
 */
export function sortByStartedAtDesc<R extends RetentionRecord>(records: readonly R[]): readonly R[] {
  return [...records].sort((a, b) => startedAtMs(b) - startedAtMs(a));
}

/**
 * Select the subset of `JobLog`-shaped records to keep under the
 * given policy at the given wall-clock time. Failed jobs younger
 * than `policy.jobLogs.failedAgeMs` are pinned, even if they fall
 * outside the count cap. Successful logs are kept up to the count
 * cap, newest-first.
 *
 * `withDetailed` controls which cap is applied: `true` returns up
 * to `policy.jobLogs.detailedCount` (callers that store full entries);
 * `false` returns up to `policy.jobLogs.summariesCount` (lightweight
 * metadata views).
 */
export function selectKeptJobLogs<R extends RetentionRecord>(
  logs: readonly R[],
  policy: RetentionPolicy,
  nowMs: number,
  options: { withDetailed: boolean } = { withDetailed: false },
): readonly R[] {
  const sorted = sortByStartedAtDesc(logs);
  const count = options.withDetailed
    ? policy.jobLogs.detailedCount
    : policy.jobLogs.summariesCount;
  const failedHorizonMs = nowMs - policy.jobLogs.failedAgeMs;

  const kept: R[] = [];
  const seenIds = new Set<string>();
  // First N by recency
  for (let i = 0; i < sorted.length && kept.length < count; i++) {
    const r = sorted[i]!;
    kept.push(r);
    seenIds.add(r.id);
  }
  // Plus any failed/failed_to_start within the failed horizon
  // that we haven't already kept.
  for (const r of sorted) {
    if (seenIds.has(r.id)) continue;
    if (isFailedStatus(r.status) && startedAtMs(r) >= failedHorizonMs) {
      kept.push(r);
      seenIds.add(r.id);
    }
  }
  return kept;
}

/**
 * Select the subset of replays to keep. Same shape as
 * `selectKeptJobLogs` but with a single `count` cap (no detailed/
 * summary distinction) per audit 5C.
 */
export function selectKeptReplays<R extends RetentionRecord>(
  replays: readonly R[],
  policy: RetentionPolicy,
  nowMs: number,
): readonly R[] {
  const sorted = sortByStartedAtDesc(replays);
  const count = policy.replays.count;
  const failedHorizonMs = nowMs - policy.replays.failedAgeMs;

  const kept: R[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < sorted.length && kept.length < count; i++) {
    const r = sorted[i]!;
    kept.push(r);
    seenIds.add(r.id);
  }
  for (const r of sorted) {
    if (seenIds.has(r.id)) continue;
    if (isFailedStatus(r.status) && startedAtMs(r) >= failedHorizonMs) {
      kept.push(r);
      seenIds.add(r.id);
    }
  }
  return kept;
}

/**
 * Select the subset of crash reports to keep. Count-only — crash
 * reports do not carry a job-status discriminator; the latest N
 * by `startedAt` are kept.
 */
export function selectKeptCrashReports<R extends { id: string; startedAt: string }>(
  reports: readonly R[],
  policy: RetentionPolicy,
): readonly R[] {
  const sorted = [...reports].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
  return sorted.slice(0, policy.crashReports.count);
}

/**
 * Select the subset of RX/TX traces to keep. Audit's recommendation:
 * keep the most recent FAILED job's trace + the most recent
 * SUCCESSFUL job's trace, regardless of how many traces sit in
 * between. Returns up to `policy.rxTxTraces.lastFailed +
 * policy.rxTxTraces.lastSuccessful` records.
 */
export function selectKeptRxTxTraces<R extends RetentionRecord>(
  traces: readonly R[],
  policy: RetentionPolicy,
): readonly R[] {
  const sorted = sortByStartedAtDesc(traces);
  const failed: R[] = [];
  const succeeded: R[] = [];
  for (const r of sorted) {
    if (isFailedStatus(r.status) && failed.length < policy.rxTxTraces.lastFailed) {
      failed.push(r);
    } else if (
      r.status === 'completed'
      && succeeded.length < policy.rxTxTraces.lastSuccessful
    ) {
      succeeded.push(r);
    }
    if (
      failed.length >= policy.rxTxTraces.lastFailed
      && succeeded.length >= policy.rxTxTraces.lastSuccessful
    ) {
      break;
    }
  }
  return [...failed, ...succeeded];
}

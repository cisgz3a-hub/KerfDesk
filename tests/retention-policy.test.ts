/**
 * T3-87: pin the per-domain retention policy + selection helpers.
 *
 * Run: npx tsx tests/retention-policy.test.ts
 */

import {
  DEFAULT_RETENTION_POLICY,
  selectKeptCrashReports,
  selectKeptJobLogs,
  selectKeptReplays,
  selectKeptRxTxTraces,
  sortByStartedAtDesc,
  type RetentionJobStatus,
  type RetentionPolicy,
  type RetentionRecord,
} from '../src/diagnostics/RetentionPolicy';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const NOW = Date.parse('2026-05-10T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function rec(
  i: number,
  daysAgo: number,
  status: RetentionJobStatus = 'completed',
): RetentionRecord {
  return {
    id: `rec-${i}`,
    startedAt: new Date(NOW - daysAgo * DAY_MS).toISOString(),
    status,
  };
}

console.log('\n=== T3-87 retention policy ===\n');

void (async () => {
  // 1. Default policy values match audit recommendation.
  {
    const p = DEFAULT_RETENTION_POLICY;
    assert(p.jobLogs.summariesCount === 100, 'Default: jobLogs.summariesCount = 100');
    assert(p.jobLogs.detailedCount === 10, 'Default: jobLogs.detailedCount = 10');
    assert(p.jobLogs.failedAgeMs === 30 * DAY_MS, 'Default: jobLogs.failedAgeMs = 30 days');
    assert(p.replays.count === 20, 'Default: replays.count = 20');
    assert(p.replays.failedAgeMs === 30 * DAY_MS, 'Default: replays.failedAgeMs = 30 days');
    assert(p.crashReports.count === 20, 'Default: crashReports.count = 20');
    assert(p.rxTxTraces.lastFailed === 1, 'Default: rxTxTraces.lastFailed = 1');
    assert(p.rxTxTraces.lastSuccessful === 1, 'Default: rxTxTraces.lastSuccessful = 1');
  }

  // 2. sortByStartedAtDesc returns newest-first without mutating input.
  {
    const input: readonly RetentionRecord[] = [rec(1, 0), rec(2, 5), rec(3, 1)];
    const sorted = sortByStartedAtDesc(input);
    assert(sorted[0]?.id === 'rec-1', 'Sort: newest first');
    assert(sorted[1]?.id === 'rec-3', 'Sort: middle preserved');
    assert(sorted[2]?.id === 'rec-2', 'Sort: oldest last');
    assert(input[0]?.id === 'rec-1' && input.length === 3, 'Sort: input not mutated');
  }

  // 3. selectKeptJobLogs: count cap with default policy + summaries.
  {
    const logs: RetentionRecord[] = [];
    for (let i = 0; i < 150; i++) {
      logs.push(rec(i, i * 0.1));
    }
    const kept = selectKeptJobLogs(logs, DEFAULT_RETENTION_POLICY, NOW);
    assert(kept.length === 100, 'JobLogs summary cap: 100 kept of 150 input');
    // The kept set is the 100 most recent by startedAt.
    assert(kept[0]?.id === 'rec-0', 'JobLogs summary cap: newest is rec-0');
  }

  // 4. selectKeptJobLogs: detailed cap is smaller.
  {
    const logs: RetentionRecord[] = [];
    for (let i = 0; i < 50; i++) logs.push(rec(i, i * 0.1));
    const kept = selectKeptJobLogs(logs, DEFAULT_RETENTION_POLICY, NOW, { withDetailed: true });
    assert(kept.length === 10, 'JobLogs detailed cap: 10 kept of 50 input');
  }

  // 5. selectKeptJobLogs: failed jobs older than the count cap are
  //    pinned within the 30-day window.
  {
    const logs: RetentionRecord[] = [];
    // 20 successful, all newer than the failed log.
    for (let i = 0; i < 20; i++) logs.push(rec(i, i * 0.1));
    // 1 failed log 5 days old.
    logs.push({ id: 'failed-old', startedAt: new Date(NOW - 5 * DAY_MS).toISOString(), status: 'failed' });

    // Use a smaller summaries cap so the failed log falls outside it.
    const tightPolicy: RetentionPolicy = {
      ...DEFAULT_RETENTION_POLICY,
      jobLogs: { summariesCount: 5, detailedCount: 5, failedAgeMs: 30 * DAY_MS },
    };
    const kept = selectKeptJobLogs(logs, tightPolicy, NOW);
    const ids = new Set(kept.map((r) => r.id));
    assert(ids.has('failed-old'), 'Failed pin: 5-day-old failed log kept past summary cap');
    assert(kept.length === 6, 'Failed pin: 5 by recency + 1 pinned failed = 6 total');
  }

  // 6. selectKeptJobLogs: failed jobs older than the 30-day window
  //    are NOT pinned.
  {
    const logs: RetentionRecord[] = [];
    for (let i = 0; i < 5; i++) logs.push(rec(i, i * 0.1));
    logs.push({
      id: 'failed-ancient',
      startedAt: new Date(NOW - 60 * DAY_MS).toISOString(),
      status: 'failed',
    });

    const tightPolicy: RetentionPolicy = {
      ...DEFAULT_RETENTION_POLICY,
      jobLogs: { summariesCount: 3, detailedCount: 3, failedAgeMs: 30 * DAY_MS },
    };
    const kept = selectKeptJobLogs(logs, tightPolicy, NOW);
    const ids = new Set(kept.map((r) => r.id));
    assert(!ids.has('failed-ancient'), 'Failed pin: 60-day-old failed log not pinned (past 30-day horizon)');
  }

  // 7. selectKeptJobLogs: failed_to_start counts as failed for
  //    pinning purposes.
  {
    const logs: RetentionRecord[] = [];
    for (let i = 0; i < 5; i++) logs.push(rec(i, i * 0.1));
    logs.push({
      id: 'fts-2-day',
      startedAt: new Date(NOW - 2 * DAY_MS).toISOString(),
      status: 'failed_to_start',
    });

    const tightPolicy: RetentionPolicy = {
      ...DEFAULT_RETENTION_POLICY,
      jobLogs: { summariesCount: 3, detailedCount: 3, failedAgeMs: 30 * DAY_MS },
    };
    const kept = selectKeptJobLogs(logs, tightPolicy, NOW);
    const ids = new Set(kept.map((r) => r.id));
    assert(ids.has('fts-2-day'), 'Failed pin: failed_to_start status pinned within window');
  }

  // 8. selectKeptJobLogs does not duplicate records that are both
  //    within the count cap AND failed.
  {
    const logs: RetentionRecord[] = [
      { id: 'recent-failed', startedAt: new Date(NOW - 1 * DAY_MS).toISOString(), status: 'failed' },
      { id: 'completed', startedAt: new Date(NOW - 2 * DAY_MS).toISOString(), status: 'completed' },
    ];
    const kept = selectKeptJobLogs(logs, DEFAULT_RETENTION_POLICY, NOW);
    assert(kept.length === 2, 'No-dup: failed-and-recent counted once');
    const recentFailed = kept.filter((r) => r.id === 'recent-failed');
    assert(recentFailed.length === 1, 'No-dup: failed record present exactly once');
  }

  // 9. selectKeptReplays: count cap + failed-pin.
  {
    const replays: RetentionRecord[] = [];
    for (let i = 0; i < 30; i++) replays.push(rec(i, i * 0.1));
    replays.push({
      id: 'failed-replay',
      startedAt: new Date(NOW - 10 * DAY_MS).toISOString(),
      status: 'failed',
    });
    const kept = selectKeptReplays(replays, DEFAULT_RETENTION_POLICY, NOW);
    assert(kept.length === 21, 'Replays: 20 by recency + 1 pinned failed = 21');
    assert(kept.some((r) => r.id === 'failed-replay'), 'Replays: failed-replay pinned');
  }

  // 10. selectKeptCrashReports: count-only, no status discriminator.
  {
    const reports = [];
    for (let i = 0; i < 50; i++) {
      reports.push({
        id: `crash-${i}`,
        startedAt: new Date(NOW - i * DAY_MS).toISOString(),
      });
    }
    const kept = selectKeptCrashReports(reports, DEFAULT_RETENTION_POLICY);
    assert(kept.length === 20, 'CrashReports: 20 of 50 kept');
    assert(kept[0]?.id === 'crash-0', 'CrashReports: newest first');
  }

  // 11. selectKeptRxTxTraces: keep last failed + last successful.
  {
    const traces: RetentionRecord[] = [
      rec(1, 0, 'completed'),
      rec(2, 1, 'completed'),
      rec(3, 2, 'failed'),
      rec(4, 3, 'completed'),
      rec(5, 4, 'failed'),
    ];
    const kept = selectKeptRxTxTraces(traces, DEFAULT_RETENTION_POLICY);
    assert(kept.length === 2, 'RxTxTraces: exactly 2 kept (1 failed + 1 succeeded)');
    const ids = new Set(kept.map((r) => r.id));
    assert(ids.has('rec-3'), 'RxTxTraces: most recent failed (rec-3) kept');
    assert(ids.has('rec-1'), 'RxTxTraces: most recent successful (rec-1) kept');
    assert(!ids.has('rec-5'), 'RxTxTraces: older failed (rec-5) NOT kept');
    assert(!ids.has('rec-4'), 'RxTxTraces: older successful (rec-4) NOT kept');
  }

  // 12. selectKeptRxTxTraces: empty input returns empty.
  {
    const kept = selectKeptRxTxTraces([], DEFAULT_RETENTION_POLICY);
    assert(kept.length === 0, 'RxTxTraces empty: returns empty');
  }

  // 13. selectKeptRxTxTraces: only-failed traces still returns just
  //     the most recent failed.
  {
    const traces: RetentionRecord[] = [
      rec(1, 0, 'failed'),
      rec(2, 1, 'failed'),
      rec(3, 2, 'failed'),
    ];
    const kept = selectKeptRxTxTraces(traces, DEFAULT_RETENTION_POLICY);
    assert(kept.length === 1, 'RxTxTraces only-failed: 1 kept');
    assert(kept[0]?.id === 'rec-1', 'RxTxTraces only-failed: most recent failed');
  }

  // 14. Source pin: T3-87 marker present and module is purely
  //     selection logic (no storage / live writeback imports).
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const moduleSrc = fs.readFileSync(
      path.resolve(here, '../src/diagnostics/RetentionPolicy.ts'),
      'utf-8',
    );

    assert(/T3-87/.test(moduleSrc), 'Source: T3-87 marker present');
    assert(
      !/from\s+['"][^'"]*\/storage(['"\/])/.test(moduleSrc),
      'Source: RetentionPolicy does not import storage (additive-only)',
    );
    assert(
      !/from\s+['"][^'"]*\/JobLog['"]/.test(moduleSrc),
      'Source: RetentionPolicy does not import JobLog (decoupled)',
    );
  }

  console.log(`\nT3-87 retention policy: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();

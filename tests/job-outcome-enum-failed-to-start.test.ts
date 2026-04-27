/**
 * T2-67 regression test: distinct 'failed_to_start' status value for
 * failed-start jobs.
 *
 * Background: T1-87 made failed-start jobs persist a JobLog and
 * JobReplay (so support has something to investigate when a job throws
 * before the controller starts running). T1-87 reused status='failed'
 * for those entries as a stopgap, with a comment pointing at this
 * ticket to widen the union.
 *
 * T2-67 closes that stopgap:
 *   - JobLog.status union and finalizeLog parameter type include
 *     'failed_to_start'.
 *   - JobReplay.status union and finalizeReplay parameter type include
 *     'failed_to_start'.
 *   - MachineService throw-handler uses 'failed_to_start' instead of
 *     'failed' when finalizing the partial log + replay.
 *   - JobLogViewer renders 'failed_to_start' in the same red branch as
 *     'failed' (both are failures), with the label 'FAILED TO START'
 *     so a glance distinguishes mid-run failures from never-started
 *     failures.
 *
 * Why this matters: in the log viewer, "FAILED" means very different
 * things depending on where the job failed. A job that ran for ten
 * minutes and errored out has 100s of telemetry entries to investigate.
 * A job that failed before the first command was acked has zero — the
 * debugging path is the controller-communication layer, not the cut.
 * Distinct labels let support categorize at a glance.
 *
 * What this test enforces:
 *   1. PURE LOGIC — finalizeLog and finalizeReplay accept and apply
 *      the new 'failed_to_start' value.
 *   2. STRUCTURAL — MachineService.ts throw-handler catch block uses
 *      'failed_to_start', not 'failed'. Catches future regressions
 *      where someone "fixes" the type narrowing by reverting to the
 *      old value.
 *   3. STRUCTURAL — JobLogViewer.tsx handles 'failed_to_start' in
 *      both color and label paths.
 *   4. DISPLAY — the underscore-to-space + uppercase formatter
 *      produces 'FAILED TO START'.
 *
 * Run: npx tsx tests/job-outcome-enum-failed-to-start.test.ts
 */
export {};

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type JobLog, finalizeLog } from '../src/core/job/JobLog';
import { type JobReplay, createReplay, finalizeReplay } from '../src/core/replay/JobReplay';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log("\n=== job outcome enum: 'failed_to_start' (T2-67) ===\n");

// ── PURE LOGIC: finalizeLog accepts the new value ──────────────────
{
  const log: JobLog = {
    id: 'tst_log_1',
    startedAt: new Date(Date.now() - 5_000).toISOString(),
    completedAt: null,
    status: 'running',
    projectName: 'test',
    gcodeLines: 10,
    estimatedTime: '00:01',
    layers: [],
    machineStatus: 'idle',
    startPosition: { x: 0, y: 0 },
    entries: [],
    linesCompleted: 0,
    errors: 0,
    warnings: 0,
    actualDuration: 0,
  };

  finalizeLog(log, 'failed_to_start', 0);

  assert(
    log.status === 'failed_to_start',
    `finalizeLog sets status to 'failed_to_start' (got "${log.status}")`,
  );
  assert(
    log.linesCompleted === 0,
    `finalizeLog preserves linesCompleted=0 for failed_to_start (got ${log.linesCompleted})`,
  );
  assert(
    typeof log.completedAt === 'string' && log.completedAt.length > 0,
    'finalizeLog populates completedAt for failed_to_start',
  );
  assert(
    log.actualDuration > 0,
    `finalizeLog computes actualDuration for failed_to_start (got ${log.actualDuration}ms)`,
  );
}

// ── PURE LOGIC: finalizeReplay accepts the new value ───────────────
{
  const replay: JobReplay = createReplay(
    'test',
    10,
    { layers: [], material: null, machineType: null },
    null,
  );
  const baseStart = new Date(replay.startedAt).getTime();
  replay.startedAt = new Date(baseStart - 5_000).toISOString();

  finalizeReplay(replay, 'failed_to_start', 0);

  assert(
    replay.status === 'failed_to_start',
    `finalizeReplay sets status to 'failed_to_start' (got "${replay.status}")`,
  );
  assert(
    replay.linesCompleted === 0,
    `finalizeReplay preserves linesCompleted=0 for failed_to_start (got ${replay.linesCompleted})`,
  );
  assert(
    typeof replay.completedAt === 'string' && replay.completedAt.length > 0,
    'finalizeReplay populates completedAt for failed_to_start',
  );
  assert(
    replay.durationMs > 0,
    `finalizeReplay computes durationMs for failed_to_start (got ${replay.durationMs}ms)`,
  );
}

// ── DISPLAY: underscore-to-space formatter ─────────────────────────
{
  const formatStatusLabel = (s: string): string => s.replace(/_/g, ' ').toUpperCase();
  assert(
    formatStatusLabel('failed_to_start') === 'FAILED TO START',
    "'failed_to_start'.replace(/_/g,' ').toUpperCase() === 'FAILED TO START'",
  );
  assert(formatStatusLabel('failed') === 'FAILED', "'failed' unchanged → 'FAILED'");
  assert(formatStatusLabel('completed') === 'COMPLETED', "'completed' unchanged → 'COMPLETED'");
  assert(formatStatusLabel('stopped') === 'STOPPED', "'stopped' unchanged → 'STOPPED'");
  assert(formatStatusLabel('running') === 'RUNNING', "'running' unchanged → 'RUNNING'");
}

// ── STRUCTURAL: MachineService throw-handler uses 'failed_to_start' ─
{
  const src = readFileSync(
    join(REPO_ROOT, 'src/app/MachineService.ts'),
    'utf8',
  );

  const anchor = src.indexOf('T2-67 closed');
  assert(
    anchor > 0,
    'MachineService.ts has the T2-67 closed-stopgap comment anchor',
  );

  const catchSlice = src.slice(anchor, anchor + 4000);

  assert(
    /finalizeLog\([^)]*['"]failed_to_start['"]/.test(catchSlice),
    "MachineService throw-handler catch: finalizeLog called with 'failed_to_start'",
  );

  assert(
    /finalizeReplay\([^)]*['"]failed_to_start['"]/.test(catchSlice),
    "MachineService throw-handler catch: finalizeReplay called with 'failed_to_start'",
  );

  const catchCodeOnly = catchSlice
    .replace(/(^|[\s;])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert(
    !/finalizeLog\([^)]*['"]failed['"]\s*,/.test(catchCodeOnly),
    "MachineService throw-handler catch: finalizeLog NOT called with stale 'failed' (T2-67 stopgap closed)",
  );
  assert(
    !/finalizeReplay\([^)]*['"]failed['"]\s*,/.test(catchCodeOnly),
    "MachineService throw-handler catch: finalizeReplay NOT called with stale 'failed' (T2-67 stopgap closed)",
  );
}

// ── STRUCTURAL: JobLogViewer handles 'failed_to_start' in color + label ─
{
  const src = readFileSync(
    join(REPO_ROOT, 'src/ui/components/JobLogViewer.tsx'),
    'utf8',
  );

  const failedToStartHits = (src.match(/['"]failed_to_start['"]/g) ?? []).length;
  assert(
    failedToStartHits >= 2,
    `JobLogViewer references 'failed_to_start' at least twice (border + label color paths); got ${failedToStartHits}`,
  );

  const formatterHits = (src.match(/\.replace\(\s*\/_\/g\s*,\s*['"]\s['"]\)\s*\.toUpperCase\(\)/g) ?? []).length;
  assert(
    formatterHits >= 2,
    `JobLogViewer uses the underscore-to-space formatter at least twice (Status: line + label pill); got ${formatterHits}`,
  );

  const uglyHits = (src.match(/log\.status\.toUpperCase\(\)/g) ?? []).length;
  assert(
    uglyHits === 0,
    `JobLogViewer no longer uses bare log.status.toUpperCase() without the underscore-replace; got ${uglyHits} bare uses`,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

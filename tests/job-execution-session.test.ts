/**
 * T2-45: JobExecutionSession with safety methods on the session
 * handle. Pre-T2-45 streaming used `sendJob(lines)` + scattered
 * void-returning pause/stop on MachineService — no per-job session
 * to act on, no typed completion result.
 *
 * Run: npx tsx tests/job-execution-session.test.ts
 */
import {
  ZERO_PROGRESS,
  buildJobProgress,
  buildJobCompletion,
  isSessionFinished,
  canPauseFromStatus,
  canResumeFromStatus,
  canAbortFromStatus,
  jobSessionStatusLabel,
  jobCompletionLabel,
  type JobProgress,
  type JobCompletionResult,
  type JobSessionStatus,
  type JobCompletionKind,
} from '../src/app/JobExecutionSession';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-45 JobExecutionSession ===\n');

void (async () => {

// 1. ZERO_PROGRESS shape
{
  assert(ZERO_PROGRESS.completed === 0 && ZERO_PROGRESS.percent === 0,
    `ZERO_PROGRESS = (0,0,null,0)`);
  assert(ZERO_PROGRESS.total === null, `ZERO_PROGRESS.total = null`);
  assert(ZERO_PROGRESS.elapsedSec === 0, `ZERO_PROGRESS.elapsedSec = 0`);
}

// 2. buildJobProgress: percent computed from completed/total
{
  const p = buildJobProgress({ completed: 50, total: 100, elapsedSec: 10 });
  assert(p.percent === 0.5, `50/100 = 0.5`);
  assert(p.completed === 50 && p.total === 100, `fields preserved`);
  assert(p.elapsedSec === 10, `elapsed preserved`);
}

// 3. buildJobProgress: total=null → percent=0
{
  const p = buildJobProgress({ completed: 1000, total: null, elapsedSec: 5 });
  assert(p.percent === 0, `unknown total → percent=0 (no division)`);
}

// 4. buildJobProgress: total=0 → percent=0 (avoid divide-by-zero)
{
  const p = buildJobProgress({ completed: 0, total: 0, elapsedSec: 0 });
  assert(p.percent === 0, `total=0 → percent=0`);
}

// 5. buildJobProgress: completed > total → clamped to 1
{
  const p = buildJobProgress({ completed: 200, total: 100, elapsedSec: 10 });
  assert(p.percent === 1, `over-100% clamped to 1`);
}

// 6. buildJobProgress: completed < 0 → clamped to 0 (not negative)
{
  const p = buildJobProgress({ completed: -10, total: 100, elapsedSec: 0 });
  assert(p.percent === 0, `negative completed → percent=0`);
}

// 7. buildJobCompletion: shape
{
  const c = buildJobCompletion({
    jobId: 'job-1',
    kind: 'success',
    progress: ZERO_PROGRESS,
    endedAt: 1234,
  });
  assert(c.jobId === 'job-1', `jobId set`);
  assert(c.kind === 'success', `kind set`);
  assert(c.endedAt === 1234, `endedAt set`);
  assert(c.safetyResult === undefined, `safetyResult optional`);
  assert(c.errorMessage === undefined, `errorMessage optional`);
}

// 8. buildJobCompletion: with safetyResult and errorMessage
{
  const c = buildJobCompletion({
    jobId: 'job-2',
    kind: 'aborted-by-user',
    progress: buildJobProgress({ completed: 30, total: 100, elapsedSec: 5 }),
    safetyResult: {
      action: 'abortJob', accepted: true,
      motionState: 'stopped', laserState: 'commandedOff',
      positionTrusted: false, requiresRehome: true,
      requiresReconnect: false, requiresInspection: false,
      timestamp: 1000,
    },
    errorMessage: 'user pressed abort',
    endedAt: 5000,
  });
  assert(c.kind === 'aborted-by-user', `kind`);
  assert(c.safetyResult?.action === 'abortJob', `safetyResult carried`);
  assert(c.errorMessage === 'user pressed abort', `errorMessage carried`);
  assert(c.progress.percent === 0.3, `progress carried`);
}

// 9. JobCompletionKind: 7 kinds covered by label
{
  const kinds: JobCompletionKind[] = [
    'success', 'aborted-by-user', 'aborted-emergency',
    'controller-error', 'transport-error',
    'paused-discarded', 'unknown',
  ];
  const labels = new Set<string>();
  for (const k of kinds) {
    const l = jobCompletionLabel(k);
    assert(l.length > 0, `'${k}' label non-empty`);
    labels.add(l);
  }
  assert(labels.size === 7, `7 distinct labels`);
}

// 10. jobCompletionLabel: emergency abort label distinct
{
  const a = jobCompletionLabel('aborted-by-user');
  const e = jobCompletionLabel('aborted-emergency');
  assert(a !== e, `user vs emergency abort labels distinct`);
  assert(e.toLowerCase().includes('emergency'), `emergency label names emergency`);
}

// 11. JobSessionStatus: 6 statuses covered by label
{
  const ss: JobSessionStatus[] = [
    'starting', 'running', 'pauseRequested', 'paused',
    'abortRequested', 'finished',
  ];
  const labels = new Set<string>();
  for (const s of ss) {
    const l = jobSessionStatusLabel(s);
    assert(l.length > 0, `'${s}' label non-empty`);
    labels.add(l);
  }
  assert(labels.size === 6, `6 distinct status labels`);
}

// 12. isSessionFinished: only 'finished'
{
  assert(isSessionFinished('finished'), `finished → true`);
  for (const s of ['starting', 'running', 'pauseRequested', 'paused',
                   'abortRequested'] as JobSessionStatus[]) {
    assert(!isSessionFinished(s), `'${s}' → false`);
  }
}

// 13. canPauseFromStatus: only 'running'
{
  assert(canPauseFromStatus('running'), `running → can pause`);
  for (const s of ['starting', 'pauseRequested', 'paused',
                   'abortRequested', 'finished'] as JobSessionStatus[]) {
    assert(!canPauseFromStatus(s), `'${s}' → cannot pause`);
  }
}

// 14. canResumeFromStatus: only 'paused'
{
  assert(canResumeFromStatus('paused'), `paused → can resume`);
  for (const s of ['starting', 'running', 'pauseRequested',
                   'abortRequested', 'finished'] as JobSessionStatus[]) {
    assert(!canResumeFromStatus(s), `'${s}' → cannot resume`);
  }
}

// 15. canAbortFromStatus: every status except 'finished'
{
  for (const s of ['starting', 'running', 'pauseRequested', 'paused',
                   'abortRequested'] as JobSessionStatus[]) {
    assert(canAbortFromStatus(s), `'${s}' → can abort`);
  }
  assert(!canAbortFromStatus('finished'), `'finished' → cannot abort`);
}

// 16. THE audit's headline: typed completion replaces void return
{
  // pre-T2-45 callsite: await ms.sendJob(lines); — caller can't tell why
  // post-T2-45: const result = await session.abort('normal'); + onComplete
  const c: JobCompletionResult = buildJobCompletion({
    jobId: 'audit-headline',
    kind: 'aborted-by-user',
    progress: buildJobProgress({ completed: 50, total: 100, elapsedSec: 5 }),
    endedAt: 1000,
  });
  assert(c.kind === 'aborted-by-user',
    `caller learns aborted-by-user vs success vs error`);
  assert(c.progress.percent === 0.5,
    `caller learns how far the job got at abort time`);
}

// 17. JobProgress round-trip clean values
{
  const p: JobProgress = buildJobProgress({ completed: 25, total: 100, elapsedSec: 12.5 });
  assert(p.completed === 25 && p.total === 100 && p.percent === 0.25 && p.elapsedSec === 12.5,
    `round-trip values preserved`);
}

// 18. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/JobExecutionSession.ts'), 'utf-8');
  assert(/T2-45/.test(src), 'T2-45 marker');
  for (const id of [
    'JobExecutionModel', 'JobProgress', 'JobCompletionKind',
    'JobCompletionResult', 'JobSessionStatus', 'JobExecutionSession',
    'ZERO_PROGRESS', 'buildJobProgress', 'buildJobCompletion',
    'isSessionFinished', 'canPauseFromStatus', 'canResumeFromStatus',
    'canAbortFromStatus', 'jobSessionStatusLabel', 'jobCompletionLabel',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of ['success', 'aborted-by-user', 'aborted-emergency',
                   'controller-error', 'transport-error',
                   'paused-discarded', 'unknown']) {
    assert(src.includes(`'${k}'`), `kind '${k}' declared`);
  }
  for (const s of ['starting', 'running', 'pauseRequested', 'paused',
                   'abortRequested', 'finished']) {
    assert(src.includes(`'${s}'`), `status '${s}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

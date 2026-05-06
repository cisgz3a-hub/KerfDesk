/**
 * T2-53: JobPhase state machine. Pre-T2-53 6 different authorities
 * answered "is the job running?" — and could disagree. Audit 4A
 * Finding 2 + Duplication 4 + Critical Failure 4 + Required Fix 5.
 *
 * Run: npx tsx tests/job-session-transitions.test.ts
 */
import {
  jobPhaseInitial,
  onJobStartRequested,
  onControllerJobRunning,
  onPauseResult,
  onControllerHold,
  onResumeResult,
  onStopRequested,
  onJobCompleted,
  onJobFailed,
  clearJobPhase,
  selectIsRunning,
  selectIsPaused,
  selectIsStopping,
  selectIsActive,
  selectTicketId,
  selectProgress,
  selectError,
  type JobPhase,
  type JobProgressLike,
  type SafetyResultLike,
} from '../src/app/JobSession';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-53 JobPhase transitions ===\n');

const progress0: JobProgressLike = { percent: 0, linesDone: 0, linesTotal: 100, elapsedMs: 0 };
const progress50: JobProgressLike = { percent: 50, linesDone: 50, linesTotal: 100, elapsedMs: 1000 };

void (async () => {

// 1. Initial state
{
  const p = jobPhaseInitial;
  assert(p.phase === 'idle', `initial = idle`);
  assert(!selectIsRunning(p) && !selectIsPaused(p) && !selectIsActive(p),
    `idle: nothing active`);
  assert(selectTicketId(p) === null, `idle: ticketId null`);
}

// 2. start request from idle → starting
{
  const p = onJobStartRequested({ current: jobPhaseInitial, ticketId: 't1', now: 100 });
  assert(p.phase === 'starting', `idle + start → starting`);
  if (p.phase === 'starting') {
    assert(p.ticketId === 't1' && p.startedAt === 100, `metadata carried`);
  }
}

// 3. start request from running is no-op (must complete or fail first)
{
  const running: JobPhase = {
    phase: 'running', ticketId: 't1', startedAt: 100, progress: progress0,
  };
  const p = onJobStartRequested({ current: running, ticketId: 't2', now: 200 });
  assert(p === running, `start from running: no-op`);
}

// 4. controller running → running
{
  const starting: JobPhase = { phase: 'starting', ticketId: 't1', startedAt: 100 };
  const p = onControllerJobRunning({ current: starting, progress: progress0 });
  assert(p.phase === 'running', `starting + controller running → running`);
  if (p.phase === 'running') {
    assert(p.ticketId === 't1' && p.startedAt === 100,
      `ticketId + startedAt preserved`);
  }
}

// 5. progress tick: running → running with new progress
{
  const running: JobPhase = {
    phase: 'running', ticketId: 't1', startedAt: 100, progress: progress0,
  };
  const p = onControllerJobRunning({ current: running, progress: progress50 });
  assert(p.phase === 'running', `running + tick → running`);
  if (p.phase === 'running') {
    assert(p.progress.percent === 50, `progress updated`);
    assert(selectProgress(p)?.percent === 50, `selectProgress`);
  }
}

// 6. pause accepted → paused
{
  const running: JobPhase = {
    phase: 'running', ticketId: 't1', startedAt: 100, progress: progress50,
  };
  const result: SafetyResultLike = { action: 'pause', accepted: true };
  const p = onPauseResult({ current: running, result, reason: 'user', now: 200 });
  assert(p.phase === 'paused', `pause accepted → paused`);
  if (p.phase === 'paused') {
    assert(p.pausedAt === 200 && p.reason === 'user', `pausedAt + reason carried`);
  }
}

// 7. **CLASSIC FAILURE PREVENTED**: pause refused → stays running
{
  const running: JobPhase = {
    phase: 'running', ticketId: 't1', startedAt: 100, progress: progress50,
  };
  const result: SafetyResultLike = { action: 'pause', accepted: false, message: 'port busy' };
  const p = onPauseResult({ current: running, result, reason: 'user', now: 200 });
  assert(p.phase === 'running',
    `pause REFUSED: phase stays 'running' (no optimistic 'paused' transition)`);
}

// 8. wrong action passed to onPauseResult is no-op
{
  const running: JobPhase = {
    phase: 'running', ticketId: 't1', startedAt: 100, progress: progress50,
  };
  const result: SafetyResultLike = { action: 'resume', accepted: true };
  const p = onPauseResult({ current: running, result, reason: 'user', now: 200 });
  assert(p === running, `wrong action: no-op`);
}

// 9. firmware-initiated hold → paused with reason='firmware' / 'door'
{
  const running: JobPhase = {
    phase: 'running', ticketId: 't1', startedAt: 100, progress: progress50,
  };
  const p1 = onControllerHold({ current: running, reason: 'firmware', now: 300 });
  assert(p1.phase === 'paused', `controller hold → paused`);
  if (p1.phase === 'paused') {
    assert(p1.reason === 'firmware', `firmware-initiated reason carried`);
  }

  const p2 = onControllerHold({ current: running, reason: 'door', now: 300 });
  if (p2.phase === 'paused') {
    assert(p2.reason === 'door', `door-interlock reason carried`);
  }
}

// 10. resume accepted → running
{
  const paused: JobPhase = {
    phase: 'paused', ticketId: 't1', startedAt: 100, pausedAt: 200, reason: 'user',
  };
  const result: SafetyResultLike = { action: 'resume', accepted: true };
  const p = onResumeResult({ current: paused, result });
  assert(p.phase === 'running', `resume accepted → running`);
  if (p.phase === 'running') {
    assert(p.ticketId === 't1' && p.startedAt === 100,
      `ticket + startedAt preserved across pause/resume`);
  }
}

// 11. resume refused → stays paused
{
  const paused: JobPhase = {
    phase: 'paused', ticketId: 't1', startedAt: 100, pausedAt: 200, reason: 'user',
  };
  const result: SafetyResultLike = { action: 'resume', accepted: false };
  const p = onResumeResult({ current: paused, result });
  assert(p.phase === 'paused', `resume refused: phase stays 'paused'`);
}

// 12. stop from running → stopping
{
  const running: JobPhase = {
    phase: 'running', ticketId: 't1', startedAt: 100, progress: progress50,
  };
  const p = onStopRequested({ current: running, reason: 'user' });
  assert(p.phase === 'stopping', `stop from running → stopping`);
  if (p.phase === 'stopping') {
    assert(p.reason === 'user', `reason carried`);
  }
}

// 13. stop from paused → stopping
{
  const paused: JobPhase = {
    phase: 'paused', ticketId: 't1', startedAt: 100, pausedAt: 200, reason: 'user',
  };
  const p = onStopRequested({ current: paused, reason: 'user' });
  assert(p.phase === 'stopping', `stop from paused → stopping`);
}

// 14. stop from idle is no-op
{
  const p = onStopRequested({ current: jobPhaseInitial, reason: 'user' });
  assert(p === jobPhaseInitial, `stop from idle: no-op`);
}

// 15. completion from running → completed
{
  const running: JobPhase = {
    phase: 'running', ticketId: 't1', startedAt: 100, progress: progress50,
  };
  const p = onJobCompleted({ current: running, now: 500 });
  assert(p.phase === 'completed', `running → completed`);
  if (p.phase === 'completed') {
    assert(p.startedAt === 100 && p.completedAt === 500,
      `timestamps carried`);
  }
}

// 16. completion from stopping → completed
{
  const stopping: JobPhase = { phase: 'stopping', ticketId: 't1', reason: 'user' };
  const p = onJobCompleted({ current: stopping, now: 500 });
  assert(p.phase === 'completed', `stopping → completed`);
}

// 17. completion from idle is no-op
{
  const p = onJobCompleted({ current: jobPhaseInitial, now: 500 });
  assert(p === jobPhaseInitial, `completion from idle: no-op`);
}

// 18. failure from running → failed
{
  const running: JobPhase = {
    phase: 'running', ticketId: 't1', startedAt: 100, progress: progress50,
  };
  const p = onJobFailed({ current: running, error: { message: 'alarm 1', alarmCode: 1 } });
  assert(p.phase === 'failed', `running → failed`);
  if (p.phase === 'failed') {
    assert(p.error.message === 'alarm 1' && p.error.alarmCode === 1,
      `error metadata carried`);
  }
  assert(selectError(p)?.alarmCode === 1, `selectError`);
}

// 19. failure from idle is no-op
{
  const p = onJobFailed({ current: jobPhaseInitial, error: { message: 'x' } });
  assert(p === jobPhaseInitial, `failure from idle: no-op`);
}

// 20. clearJobPhase → idle
{
  assert(clearJobPhase().phase === 'idle', `clear → idle`);
}

// 21. End-to-end: idle → starting → running → paused → running → stopping → completed
{
  let p: JobPhase = jobPhaseInitial;
  p = onJobStartRequested({ current: p, ticketId: 't1', now: 100 });
  p = onControllerJobRunning({ current: p, progress: progress0 });
  p = onPauseResult({ current: p, result: { action: 'pause', accepted: true }, reason: 'user', now: 200 });
  p = onResumeResult({ current: p, result: { action: 'resume', accepted: true } });
  p = onStopRequested({ current: p, reason: 'user' });
  p = onJobCompleted({ current: p, now: 500 });
  assert(p.phase === 'completed', `e2e: ends at completed`);
  if (p.phase === 'completed') {
    assert(p.ticketId === 't1', `ticketId preserved across all transitions`);
  }
}

// 22. selectIsActive: starting/running/paused/stopping all active
{
  const cases: Array<[JobPhase, boolean]> = [
    [{ phase: 'idle' }, false],
    [{ phase: 'starting', ticketId: 't', startedAt: 0 }, true],
    [{ phase: 'running', ticketId: 't', startedAt: 0, progress: progress0 }, true],
    [{ phase: 'paused', ticketId: 't', startedAt: 0, pausedAt: 0, reason: 'user' }, true],
    [{ phase: 'stopping', ticketId: 't', reason: 'user' }, true],
    [{ phase: 'completed', ticketId: 't', startedAt: 0, completedAt: 0 }, false],
    [{ phase: 'failed', ticketId: 't', error: { message: 'x' } }, false],
  ];
  for (const [phase, expected] of cases) {
    assert(selectIsActive(phase) === expected,
      `selectIsActive('${phase.phase}') === ${expected}`);
  }
}

// 23. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/JobSession.ts'), 'utf-8');
  assert(/T2-53/.test(src), 'T2-53 marker in JobSession.ts');
  for (const id of [
    'JobPhase', 'JobProgressLike', 'JobError', 'PauseReason', 'StopReason',
    'jobPhaseInitial',
    'onJobStartRequested', 'onControllerJobRunning', 'onPauseResult',
    'onControllerHold', 'onResumeResult', 'onStopRequested',
    'onJobCompleted', 'onJobFailed', 'clearJobPhase',
    'selectIsRunning', 'selectIsPaused', 'selectIsStopping', 'selectIsActive',
    'selectTicketId', 'selectProgress', 'selectError',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of ['idle', 'starting', 'running', 'paused', 'stopping', 'completed', 'failed']) {
    assert(src.includes(`'${k}'`), `phase '${k}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

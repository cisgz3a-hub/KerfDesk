/**
 * T2-51: atomic CompiledJobState. Pre-T2-51 compile state was 5
 * React states + 4 refs that drifted. Audit 4A Critical Failure 2 +
 * Duplication 1 + Required Fix 2.
 *
 * Run: npx tsx tests/compiled-job-state.test.ts
 */
import {
  compiledJobStateInitial,
  startCompile,
  completeCompile,
  failCompile,
  markStale,
  clearCompiledJob,
  selectGcode,
  selectMachinePlanBounds,
  selectTicket,
  selectIsStale,
  selectIsCompiling,
  selectIsReady,
  selectError,
  selectStaleResult,
  selectStaleReason,
  type CompiledJobState,
  type CompileResultLike,
} from '../src/app/CompiledJobState';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-51 CompiledJobState ===\n');

function makeResult(): CompileResultLike {
  return {
    gcode: 'G21\nG90\nM5 S0\nG0 X0 Y0\nM2',
    machinePlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    ticket: { ticketId: 'ticket-1' },
  };
}

void (async () => {

// 1. Initial state
{
  const s = compiledJobStateInitial;
  assert(s.status === 'none', `initial status='none'`);
  assert(selectGcode(s) === null, `selectGcode(none) = null`);
  assert(selectMachinePlanBounds(s) === null, `selectMachinePlanBounds(none) = null`);
  assert(selectTicket(s) === null, `selectTicket(none) = null`);
  assert(!selectIsStale(s), `selectIsStale(none) = false`);
  assert(!selectIsReady(s), `selectIsReady(none) = false`);
  assert(!selectIsCompiling(s), `selectIsCompiling(none) = false`);
}

// 2. startCompile → compiling
{
  const s = startCompile({
    current: compiledJobStateInitial,
    requestId: 1,
    sceneHash: 'scene-a',
    profileHash: 'profile-a',
    now: 1000,
  });
  assert(s.status === 'compiling', `startCompile → compiling`);
  if (s.status === 'compiling') {
    assert(s.requestId === 1, `requestId=1`);
    assert(s.sceneHash === 'scene-a', `sceneHash carried`);
    assert(s.startedAt === 1000, `startedAt stamped`);
  }
  assert(selectIsCompiling(s), `selectIsCompiling=true`);
}

// 3. completeCompile → ready
{
  const compiling = startCompile({
    current: compiledJobStateInitial,
    requestId: 1, sceneHash: 'a', profileHash: 'a', now: 1000,
  });
  const result = makeResult();
  const ready = completeCompile({
    current: compiling, requestId: 1, sceneHash: 'a', profileHash: 'a',
    result, now: 2000,
  });
  assert(ready.status === 'ready', `completeCompile → ready`);
  if (ready.status === 'ready') {
    assert(ready.compiledAt === 2000, `compiledAt stamped`);
    assert(ready.result === result, `result reference preserved`);
  }
  assert(selectGcode(ready)?.startsWith('G21') === true,
    `selectGcode returns gcode text`);
  assert(selectMachinePlanBounds(ready)?.maxX === 100,
    `selectMachinePlanBounds returns bounds`);
  assert(selectTicket(ready)?.ticketId === 'ticket-1',
    `selectTicket returns ticket`);
  assert(selectIsReady(ready), `selectIsReady=true`);
}

// 4. Race guard: completeCompile with stale requestId is dropped
{
  const compiling = startCompile({
    current: compiledJobStateInitial,
    requestId: 5, sceneHash: 'a', profileHash: 'a', now: 1000,
  });
  // An older compile (requestId=4) tries to complete after a newer
  // one started (requestId=5) — the old result must NOT overwrite.
  const after = completeCompile({
    current: compiling, requestId: 4, sceneHash: 'a', profileHash: 'a',
    result: makeResult(), now: 2000,
  });
  assert(after === compiling,
    `out-of-order completeCompile dropped (T1-57 race guard)`);
}

// 5. failCompile → failed
{
  const compiling = startCompile({
    current: compiledJobStateInitial,
    requestId: 1, sceneHash: 'a', profileHash: 'a', now: 1000,
  });
  const after = failCompile({
    current: compiling, requestId: 1, sceneHash: 'a', profileHash: 'a',
    error: 'compile failed: undefined font',
  });
  assert(after.status === 'failed', `failCompile → failed`);
  assert(selectError(after) === 'compile failed: undefined font',
    `selectError returns the error string`);
  assert(selectGcode(after) === null, `selectGcode(failed) = null`);
}

// 6. failCompile race guard
{
  const compiling = startCompile({
    current: compiledJobStateInitial,
    requestId: 5, sceneHash: 'a', profileHash: 'a', now: 1000,
  });
  const after = failCompile({
    current: compiling, requestId: 4, sceneHash: 'a', profileHash: 'a',
    error: 'old failure',
  });
  assert(after === compiling, `out-of-order failCompile dropped`);
}

// 7. markStale: only valid from ready
{
  const ready = completeCompile({
    current: startCompile({
      current: compiledJobStateInitial,
      requestId: 1, sceneHash: 'a', profileHash: 'a', now: 1000,
    }),
    requestId: 1, sceneHash: 'a', profileHash: 'a',
    result: makeResult(), now: 2000,
  });
  const stale = markStale(ready, 'scene-changed');
  assert(stale.status === 'stale', `markStale(ready) → stale`);
  if (stale.status === 'stale') {
    assert(stale.reason === 'scene-changed', `reason carried`);
    assert(stale.previousSceneHash === 'a', `previousSceneHash carried`);
  }
}

// 8. markStale on non-ready states is a no-op
{
  for (const s of [
    compiledJobStateInitial,
    startCompile({ current: compiledJobStateInitial, requestId: 1, sceneHash: 'a', profileHash: 'a', now: 1000 }),
    failCompile({ current: { status: 'compiling', requestId: 1, sceneHash: 'a', profileHash: 'a', startedAt: 0 }, requestId: 1, sceneHash: 'a', profileHash: 'a', error: 'x' }),
  ] as CompiledJobState[]) {
    const after = markStale(s, 'scene-changed');
    assert(after === s, `markStale(${s.status}) is a no-op`);
  }
}

// 9. selectStaleResult / selectStaleReason
{
  const ready = completeCompile({
    current: startCompile({ current: compiledJobStateInitial, requestId: 1, sceneHash: 'a', profileHash: 'a', now: 0 }),
    requestId: 1, sceneHash: 'a', profileHash: 'a', result: makeResult(), now: 0,
  });
  const stale = markStale(ready, 'profile-changed');
  assert(selectStaleResult(stale)?.gcode.startsWith('G21') === true,
    `selectStaleResult returns previous compile`);
  assert(selectStaleReason(stale) === 'profile-changed',
    `selectStaleReason returns reason`);
  // selectGcode on stale state returns null (the stale gcode is NOT
  // safe to send; T1-56 / T1-57 / T1-58 closed structurally)
  assert(selectGcode(stale) === null,
    `selectGcode(stale) = null (no stale gcode leak)`);
}

// 10. clearCompiledJob → none
{
  const ready = completeCompile({
    current: startCompile({ current: compiledJobStateInitial, requestId: 1, sceneHash: 'a', profileHash: 'a', now: 0 }),
    requestId: 1, sceneHash: 'a', profileHash: 'a', result: makeResult(), now: 0,
  });
  const cleared = clearCompiledJob();
  assert(cleared.status === 'none', `clearCompiledJob → none`);
  assert(ready.status === 'ready',
    `clearCompiledJob does not mutate the input state`);
}

// 11. End-to-end flow: none → compiling → ready → stale → recompile → ready
{
  let s: CompiledJobState = compiledJobStateInitial;
  s = startCompile({ current: s, requestId: 1, sceneHash: 'a', profileHash: 'a', now: 100 });
  s = completeCompile({ current: s, requestId: 1, sceneHash: 'a', profileHash: 'a', result: makeResult(), now: 200 });
  s = markStale(s, 'scene-changed');
  s = startCompile({ current: s, requestId: 2, sceneHash: 'b', profileHash: 'a', now: 300 });
  s = completeCompile({ current: s, requestId: 2, sceneHash: 'b', profileHash: 'a', result: makeResult(), now: 400 });
  assert(s.status === 'ready', `e2e: ends at ready`);
  if (s.status === 'ready') {
    assert(s.requestId === 2, `e2e: latest compile requestId=2`);
    assert(s.sceneHash === 'b', `e2e: latest sceneHash=b`);
  }
}

// 12. All 5 statuses produce non-null discriminator
{
  const all: CompiledJobState[] = [
    { status: 'none' },
    { status: 'compiling', requestId: 1, sceneHash: 'a', profileHash: 'a', startedAt: 0 },
    { status: 'ready', requestId: 1, sceneHash: 'a', profileHash: 'a', compiledAt: 0, result: makeResult() },
    { status: 'stale', previousResult: makeResult(), previousSceneHash: 'a', previousProfileHash: 'a', reason: 'scene-changed' },
    { status: 'failed', requestId: 1, sceneHash: 'a', profileHash: 'a', error: 'x' },
  ];
  for (const s of all) {
    assert(typeof s.status === 'string' && s.status.length > 0,
      `status='${s.status}' is non-empty string`);
  }
}

// 13. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/CompiledJobState.ts'), 'utf-8');
  assert(/T2-51/.test(src), 'T2-51 marker in CompiledJobState.ts');
  for (const id of [
    'CompiledJobState', 'CompileResultLike', 'CompileStaleReason',
    'startCompile', 'completeCompile', 'failCompile',
    'markStale', 'clearCompiledJob', 'compiledJobStateInitial',
    'selectGcode', 'selectMachinePlanBounds', 'selectTicket',
    'selectIsStale', 'selectIsCompiling', 'selectIsReady',
    'selectError', 'selectStaleResult', 'selectStaleReason',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  // Audit-derived T1-56/57/58 closure rationale documented
  assert(/T1-56|T1-57|T1-58/.test(src), `references T1-56/57/58 closure`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

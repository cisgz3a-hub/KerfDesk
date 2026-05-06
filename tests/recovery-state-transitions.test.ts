/**
 * T2-87: explicit RecoveryState state machine. Pre-T2-87 recovery
 * was implicit — alarm banner, unlock button, scattered preflight
 * blockers. Audit 4F Critical 7 + Required Priority 5.
 *
 * Run: npx tsx tests/recovery-state-transitions.test.ts
 */
import {
  recoveryStateInitial,
  recoveryAllowsStart,
  triggerAlarm,
  triggerDisconnectDuringJob,
  triggerEmergencyStop,
  triggerFrameFailed,
  triggerCompileFailed,
  ackInspection,
  ackUnlock,
  ackRehome,
  ackReframe,
  ackReconnect,
  ackRecompile,
  clearRecovery,
  pendingSteps,
  recoveryLabel,
  type RecoveryState,
} from '../src/runtime/RecoveryState';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-87 RecoveryState transitions ===\n');

void (async () => {

// 1. Initial state
{
  assert(recoveryStateInitial.status === 'none', `initial='none'`);
  assert(recoveryAllowsStart(recoveryStateInitial), `none → allows start`);
  assert(pendingSteps(recoveryStateInitial).length === 0, `none → no pending steps`);
}

// 2. Alarm trigger creates alarm state with all 4 steps required
{
  const r = triggerAlarm({
    current: recoveryStateInitial, alarmCode: 1, occurredAt: 1000, requiresRehome: true,
  });
  assert(r.status === 'alarm', `triggerAlarm → status='alarm'`);
  if (r.status === 'alarm') {
    assert(r.alarmCode === 1, `alarmCode carried`);
    assert(!r.inspectionDone && !r.unlockDone && !r.rehomeDone && !r.reframeDone,
      `all 4 steps undone`);
  }
  assert(!recoveryAllowsStart(r), `alarm blocks start`);
  assert(pendingSteps(r).length === 4, `4 pending steps (got ${pendingSteps(r).length})`);
}

// 3. Alarm without homing → 3 steps
{
  const r = triggerAlarm({
    current: recoveryStateInitial, alarmCode: 1, occurredAt: 1000, requiresRehome: false,
  });
  if (r.status === 'alarm') {
    assert(pendingSteps(r).filter((s) => s.key === 'rehomeDone').length === 0,
      `requiresRehome=false: rehome not in pending list`);
  }
  assert(pendingSteps(r).length === 3, `3 pending steps without rehome`);
}

// 4. Partial alarm recovery — start still blocked
{
  let r = triggerAlarm({
    current: recoveryStateInitial, alarmCode: 1, occurredAt: 1000, requiresRehome: true,
  });
  r = ackInspection(r);
  r = ackUnlock(r);
  // re-home + reframe still pending
  assert(!recoveryAllowsStart(r),
    `alarm with 2 of 4 steps: still blocked`);
  if (r.status === 'alarm') {
    assert(r.inspectionDone && r.unlockDone, `acked steps recorded`);
  }
}

// 5. Full alarm recovery → 'none', start unblocked
{
  let r: RecoveryState = triggerAlarm({
    current: recoveryStateInitial, alarmCode: 1, occurredAt: 1000, requiresRehome: true,
  });
  r = ackInspection(r);
  r = ackUnlock(r);
  r = ackRehome(r);
  r = ackReframe(r);
  assert(r.status === 'none', `all 4 steps done → 'none'`);
  assert(recoveryAllowsStart(r), `start unblocked`);
}

// 6. Alarm without homing: 3 acks suffice
{
  let r: RecoveryState = triggerAlarm({
    current: recoveryStateInitial, alarmCode: 1, occurredAt: 1000, requiresRehome: false,
  });
  r = ackInspection(r);
  r = ackUnlock(r);
  // rehome NOT required; ackRehome is irrelevant
  r = ackReframe(r);
  assert(r.status === 'none',
    `requiresRehome=false: completes without rehome ack`);
}

// 7. Disconnect-during-job trigger
{
  const r = triggerDisconnectDuringJob({
    current: recoveryStateInitial, occurredAt: 2000,
    lastJobLine: 1247, requiresRehome: true,
  });
  assert(r.status === 'disconnectDuringJob', `status set`);
  if (r.status === 'disconnectDuringJob') {
    assert(r.lastJobLine === 1247, `lastJobLine carried`);
    assert(!r.reconnectDone && !r.rehomeDone && !r.reframeDone, `3 steps undone`);
  }
  assert(pendingSteps(r).length === 3, `3 pending steps`);
}

// 8. Disconnect recovery flow
{
  let r: RecoveryState = triggerDisconnectDuringJob({
    current: recoveryStateInitial, occurredAt: 2000,
    lastJobLine: 100, requiresRehome: true,
  });
  r = ackReconnect(r);
  r = ackRehome(r);
  r = ackReframe(r);
  assert(r.status === 'none', `disconnect recovery completes`);
}

// 9. Emergency stop trigger requires all 3 steps
{
  const r = triggerEmergencyStop({ current: recoveryStateInitial, occurredAt: 3000 });
  assert(r.status === 'emergencyStopped', `e-stop trigger`);
  if (r.status === 'emergencyStopped') {
    assert(!r.reconnectDone && !r.rehomeDone && !r.reframeDone, `3 steps`);
  }
  assert(pendingSteps(r).length === 3, `3 pending steps`);
}

// 10. E-stop recovery
{
  let r: RecoveryState = triggerEmergencyStop({
    current: recoveryStateInitial, occurredAt: 3000,
  });
  r = ackReconnect(r);
  r = ackRehome(r);
  r = ackReframe(r);
  assert(r.status === 'none', `e-stop recovery completes`);
}

// 11. Frame-failed trigger
{
  const r = triggerFrameFailed({
    current: recoveryStateInitial, reason: 'idle-timeout', occurredAt: 4000,
  });
  assert(r.status === 'frameFailed', `frame-fail trigger`);
  if (r.status === 'frameFailed') {
    assert(r.reason === 'idle-timeout', `reason carried`);
  }
  assert(pendingSteps(r).length === 1, `1 pending step (reframe)`);
}

// 12. Frame-failed recovery via reframe
{
  let r: RecoveryState = triggerFrameFailed({
    current: recoveryStateInitial, reason: 'cancelled', occurredAt: 4000,
  });
  r = ackReframe(r);
  assert(r.status === 'none', `reframe → 'none'`);
}

// 13. Compile-failed trigger
{
  const r = triggerCompileFailed({
    current: recoveryStateInitial, errorMessage: 'profile mismatch', occurredAt: 5000,
  });
  assert(r.status === 'compileFailed', `compile-fail trigger`);
  if (r.status === 'compileFailed') {
    assert(r.errorMessage === 'profile mismatch', `errorMessage carried`);
  }
  assert(pendingSteps(r).length === 1, `1 pending step (recompile)`);
}

// 14. Compile-failed recovery via recompile
{
  let r: RecoveryState = triggerCompileFailed({
    current: recoveryStateInitial, errorMessage: 'x', occurredAt: 5000,
  });
  r = ackRecompile(r);
  assert(r.status === 'none', `recompile → 'none'`);
}

// 15. Severity ordering: alarm > frameFailed (alarm wins)
{
  const frame = triggerFrameFailed({
    current: recoveryStateInitial, reason: 'cancelled', occurredAt: 1000,
  });
  const alarm = triggerAlarm({
    current: frame, alarmCode: 1, occurredAt: 2000, requiresRehome: true,
  });
  assert(alarm.status === 'alarm', `alarm overrides frameFailed`);
}

// 16. Severity ordering: emergencyStopped > alarm
{
  const alarm = triggerAlarm({
    current: recoveryStateInitial, alarmCode: 1, occurredAt: 1000, requiresRehome: true,
  });
  const eStop = triggerEmergencyStop({ current: alarm, occurredAt: 2000 });
  assert(eStop.status === 'emergencyStopped', `e-stop overrides alarm`);
}

// 17. Severity ordering: alarm does NOT override emergencyStopped
//     (lower-severity trigger ignored when more-severe state is active)
{
  const eStop = triggerEmergencyStop({ current: recoveryStateInitial, occurredAt: 1000 });
  const alarmAttempt = triggerAlarm({
    current: eStop, alarmCode: 9, occurredAt: 2000, requiresRehome: true,
  });
  assert(alarmAttempt.status === 'emergencyStopped',
    `alarm trigger does NOT override e-stop`);
}

// 18. Severity ordering: frameFailed cannot demote compileFailed
{
  const compileFailed = triggerCompileFailed({
    current: recoveryStateInitial, errorMessage: 'x', occurredAt: 1000,
  });
  const frame = triggerFrameFailed({
    current: compileFailed, reason: 'cancelled', occurredAt: 2000,
  });
  assert(frame.status === 'compileFailed',
    `frameFailed (lower) cannot demote compileFailed (higher)`);
}

// 19. clearRecovery → 'none'
{
  const r = triggerAlarm({
    current: recoveryStateInitial, alarmCode: 1, occurredAt: 1000, requiresRehome: true,
  });
  const cleared = clearRecovery();
  assert(cleared.status === 'none', `clearRecovery → 'none'`);
  assert(r.status === 'alarm', `original NOT mutated`);
}

// 20. ack on 'none' is a no-op
{
  const r = ackInspection(recoveryStateInitial);
  assert(r.status === 'none', `ack on 'none' returns 'none'`);
}

// 21. recoveryLabel: every status has a non-empty label except 'none'
{
  const cases: RecoveryState[] = [
    { status: 'alarm', alarmCode: 1, occurredAt: 0, requiresRehome: true,
      inspectionDone: false, unlockDone: false, rehomeDone: false, reframeDone: false },
    { status: 'disconnectDuringJob', occurredAt: 0, lastJobLine: 0, requiresRehome: true,
      reconnectDone: false, rehomeDone: false, reframeDone: false },
    { status: 'emergencyStopped', occurredAt: 0,
      reconnectDone: false, rehomeDone: false, reframeDone: false },
    { status: 'frameFailed', reason: 'idle-timeout', occurredAt: 0, reframeDone: false },
    { status: 'compileFailed', errorMessage: 'x', occurredAt: 0, recompileDone: false },
  ];
  const labels = new Set<string>();
  for (const r of cases) {
    const l = recoveryLabel(r);
    assert(l.length > 0, `${r.status}: non-empty label`);
    labels.add(l);
  }
  assert(labels.size === cases.length,
    `each status has a distinct label`);
  assert(recoveryLabel(recoveryStateInitial) === '',
    `'none' label is empty`);
}

// 22. End-to-end: alarm during job → full recovery sequence → start unblocked
{
  let r: RecoveryState = recoveryStateInitial;
  assert(recoveryAllowsStart(r), `start initially allowed`);
  r = triggerAlarm({ current: r, alarmCode: 9, occurredAt: 100, requiresRehome: true });
  assert(!recoveryAllowsStart(r), `alarm blocks start`);
  // Operator works through the checklist
  r = ackInspection(r); assert(!recoveryAllowsStart(r), `still blocked after inspect`);
  r = ackUnlock(r); assert(!recoveryAllowsStart(r), `still blocked after unlock`);
  r = ackRehome(r); assert(!recoveryAllowsStart(r), `still blocked after rehome`);
  r = ackReframe(r); assert(recoveryAllowsStart(r), `unblocked after final step`);
}

// 23. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/runtime/RecoveryState.ts'), 'utf-8');
  assert(/T2-87/.test(src), 'T2-87 marker in RecoveryState.ts');
  for (const id of [
    'RecoveryState', 'recoveryStateInitial', 'recoveryAllowsStart',
    'triggerAlarm', 'triggerDisconnectDuringJob', 'triggerEmergencyStop',
    'triggerFrameFailed', 'triggerCompileFailed',
    'ackInspection', 'ackUnlock', 'ackRehome', 'ackReframe',
    'ackReconnect', 'ackRecompile',
    'clearRecovery', 'pendingSteps', 'recoveryLabel',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of [
    'none', 'alarm', 'disconnectDuringJob', 'emergencyStopped',
    'frameFailed', 'compileFailed',
  ]) {
    assert(src.includes(`'${k}'`), `status '${k}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

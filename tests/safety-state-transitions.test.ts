/**
 * T2-44: extended safety state machine — refines T2-12 with audit
 * 3D's pause-requested / paused-verified / abort-requested / etc.
 * states. Audit 3D Required P1.
 *
 * Run: npx tsx tests/safety-state-transitions.test.ts
 */
import {
  transitionFromSafetyResult,
  safetyStateInitial,
  safetyStateBlocksAllCommands,
  safetyStateAllowsStartJob,
  safetyStateAllowsResume,
  safetyStateRequiresRehome,
  clearToSafeIdle,
  safetyStateLabel,
  type SafetyState,
  type SafetyResultLike,
} from '../src/app/SafetyStateMachine';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-44 Safety state transitions ===\n');

function r(partial: Partial<SafetyResultLike> & { action: SafetyResultLike['action'] }): SafetyResultLike {
  return {
    accepted: true,
    motionState: 'unknown',
    laserState: 'unknown',
    positionTrusted: 'unknown',
    ...partial,
  };
}

void (async () => {

// 1. Initial state
{
  assert(safetyStateInitial.kind === 'safeIdle', `initial → safeIdle`);
}

// 2. pause accepted, motion not yet paused → pauseRequested
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'pause', motionState: 'moving' }), 1000);
  assert(s.kind === 'pauseRequested', `pause + motion=moving → pauseRequested`);
  if (s.kind === 'pauseRequested') {
    assert(s.sentAt === 1000, `sentAt stamped`);
  }
}

// 3. pause accepted, motion confirmed paused → pausedVerified
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'pause', motionState: 'paused' }), 1000);
  assert(s.kind === 'pausedVerified', `pause + motion=paused → pausedVerified`);
}

// 4. pause not accepted → unsafeUnknown
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'pause', accepted: false, message: 'port busy' }), 1000);
  assert(s.kind === 'unsafeUnknown', `pause not accepted → unsafeUnknown`);
  if (s.kind === 'unsafeUnknown') {
    assert(s.reason.includes('port busy') || s.reason.includes('not accepted'),
      `reason carried`);
  }
}

// 5. resume accepted → running
{
  const s = transitionFromSafetyResult({ kind: 'pausedVerified' },
    r({ action: 'resume' }), 1000);
  assert(s.kind === 'running', `resume → running`);
}

// 6. resume not accepted → unsafeUnknown
{
  const s = transitionFromSafetyResult({ kind: 'pausedVerified' },
    r({ action: 'resume', accepted: false }), 1000);
  assert(s.kind === 'unsafeUnknown', `resume not accepted → unsafeUnknown`);
}

// 7. emergencyStop accepted, position not trusted → stoppedPositionUnknown
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'emergencyStop', positionTrusted: false }), 1000);
  assert(s.kind === 'stoppedPositionUnknown',
    `e-stop + position untrusted → stoppedPositionUnknown`);
}

// 8. emergencyStop with requiresInspection → requiresInspection
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'emergencyStop', requiresInspection: true,
       message: 'Soft reset; check head position' }), 1000);
  assert(s.kind === 'requiresInspection',
    `e-stop + requiresInspection → requiresInspection`);
  if (s.kind === 'requiresInspection') {
    assert(s.reason.includes('check head'), `reason carried`);
  }
}

// 9. emergencyStop accepted, motion stopped, position trusted → safeIdle
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'emergencyStop', motionState: 'stopped', positionTrusted: true }), 1000);
  assert(s.kind === 'safeIdle', `clean e-stop → safeIdle`);
}

// 10. emergencyStop accepted, motion not yet stopped → abortRequested
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'emergencyStop', motionState: 'unknown', positionTrusted: 'unknown' }), 1000);
  assert(s.kind === 'abortRequested',
    `e-stop accepted but motion unknown → abortRequested`);
  if (s.kind === 'abortRequested') {
    assert(s.emergency === true, `emergency=true on abortRequested from e-stop`);
  }
}

// 11. emergencyStop not accepted → unsafeUnknown
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'emergencyStop', accepted: false }), 1000);
  assert(s.kind === 'unsafeUnknown',
    `e-stop not accepted → unsafeUnknown`);
}

// 12. stop with requiresRehome → stoppedPositionUnknown
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'stop', requiresRehome: true, positionTrusted: false,
       message: 'Soft reset issued; rehome before continuing' }), 1000);
  assert(s.kind === 'stoppedPositionUnknown',
    `stop + requiresRehome → stoppedPositionUnknown`);
}

// 13. stop emergency=false on abortRequested
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'stop', motionState: 'unknown' }), 1000);
  if (s.kind === 'abortRequested') {
    assert(s.emergency === false, `regular stop: emergency=false`);
  } else {
    assert(false, `unexpected kind ${s.kind}`);
  }
}

// 14. laserOff confirmed when not running → safeIdle
{
  const s = transitionFromSafetyResult({ kind: 'safeIdle' },
    r({ action: 'laserOff', laserState: 'confirmed' }), 1000);
  assert(s.kind === 'safeIdle', `laserOff confirmed when idle → safeIdle`);
}

// 15. laserOff confirmed during running → state preserved
{
  const s = transitionFromSafetyResult({ kind: 'running' },
    r({ action: 'laserOff', laserState: 'confirmed' }), 1000);
  assert(s.kind === 'running',
    `laserOff during running: state preserved (no spurious transition to idle)`);
}

// 16. laserOff commanded but unconfirmed → laserOffCommandedUnknown
{
  const s = transitionFromSafetyResult({ kind: 'safeIdle' },
    r({ action: 'laserOff', laserState: 'commanded' }), 2000);
  assert(s.kind === 'laserOffCommandedUnknown',
    `laserOff commanded only → laserOffCommandedUnknown`);
}

// 17. laserOff not accepted → unsafeUnknown
{
  const s = transitionFromSafetyResult({ kind: 'safeIdle' },
    r({ action: 'laserOff', accepted: false }), 1000);
  assert(s.kind === 'unsafeUnknown', `laserOff refused → unsafeUnknown`);
}

// 18. disconnectSafe doesn't change SAFETY state (T2-12 owns disconnect)
{
  const s = transitionFromSafetyResult({ kind: 'safeIdle' },
    r({ action: 'disconnectSafe' }), 1000);
  assert(s.kind === 'safeIdle',
    `disconnectSafe: SAFETY state unchanged (T2-12 owns disconnect taxonomy)`);
}

// 19. testFire begin/end accepted → state preserved
{
  const beginRunning = transitionFromSafetyResult({ kind: 'safeIdle' },
    r({ action: 'beginTestFire' }), 1000);
  assert(beginRunning.kind === 'safeIdle',
    `beginTestFire accepted: state preserved (T2-12 RUNNING_TEMP_LASER)`);
  const endRunning = transitionFromSafetyResult({ kind: 'safeIdle' },
    r({ action: 'endTestFire' }), 1000);
  assert(endRunning.kind === 'safeIdle', `endTestFire: state preserved`);
}

// 20. safetyStateBlocksAllCommands: only unsafe + inspection
{
  const blocking: SafetyState[] = [
    { kind: 'unsafeUnknown', reason: 'x' },
    { kind: 'requiresInspection', reason: 'y' },
  ];
  for (const s of blocking) {
    assert(safetyStateBlocksAllCommands(s), `${s.kind}: blocks all commands`);
  }
  const ok: SafetyState[] = [
    { kind: 'safeIdle' },
    { kind: 'running' },
    { kind: 'pausedVerified' },
    { kind: 'stoppedPositionUnknown', reason: 'x' },
  ];
  for (const s of ok) {
    assert(!safetyStateBlocksAllCommands(s), `${s.kind}: does NOT block`);
  }
}

// 21. safetyStateAllowsStartJob: only safeIdle
{
  assert(safetyStateAllowsStartJob({ kind: 'safeIdle' }), `safeIdle allows start`);
  for (const k of [
    'running', 'pausedVerified', 'pauseRequested', 'unsafeUnknown',
    'stoppedPositionUnknown',
  ] as const) {
    const s = (k === 'pauseRequested'
      ? { kind: 'pauseRequested' as const, sentAt: 0 }
      : k === 'unsafeUnknown' ? { kind: 'unsafeUnknown' as const, reason: 'x' }
      : k === 'stoppedPositionUnknown' ? { kind: 'stoppedPositionUnknown' as const, reason: 'x' }
      : { kind: k }) as SafetyState;
    assert(!safetyStateAllowsStartJob(s),
      `${k}: does NOT allow start`);
  }
}

// 22. safetyStateAllowsResume: only pausedVerified
{
  assert(safetyStateAllowsResume({ kind: 'pausedVerified' }),
    `pausedVerified: allows resume`);
  assert(!safetyStateAllowsResume({ kind: 'pauseRequested', sentAt: 0 }),
    `pauseRequested: NOT yet allowed (still awaiting verification)`);
  assert(!safetyStateAllowsResume({ kind: 'safeIdle' }),
    `safeIdle: resume not applicable`);
}

// 23. safetyStateRequiresRehome
{
  assert(safetyStateRequiresRehome({ kind: 'stoppedPositionUnknown', reason: 'x' }),
    `stoppedPositionUnknown: requires rehome`);
  assert(!safetyStateRequiresRehome({ kind: 'safeIdle' }),
    `safeIdle: no rehome required`);
}

// 24. clearToSafeIdle
{
  assert(clearToSafeIdle().kind === 'safeIdle', `clearToSafeIdle returns safeIdle`);
}

// 25. safetyStateLabel: every kind has a non-empty label
{
  const all: SafetyState[] = [
    { kind: 'safeIdle' },
    { kind: 'running' },
    { kind: 'pauseRequested', sentAt: 0 },
    { kind: 'pausedVerified' },
    { kind: 'abortRequested', sentAt: 0, emergency: false },
    { kind: 'abortRequested', sentAt: 0, emergency: true },
    { kind: 'emergencyStopping', sentAt: 0 },
    { kind: 'stoppedPositionUnknown', reason: 'x' },
    { kind: 'laserOffCommandedUnknown', sentAt: 0 },
    { kind: 'unsafeUnknown', reason: 'x' },
    { kind: 'requiresInspection', reason: 'x' },
  ];
  for (const s of all) {
    assert(safetyStateLabel(s).length > 0, `${s.kind}: non-empty label`);
  }
  // emergency vs regular stop have distinct labels
  const reg = safetyStateLabel({ kind: 'abortRequested', sentAt: 0, emergency: false });
  const emg = safetyStateLabel({ kind: 'abortRequested', sentAt: 0, emergency: true });
  assert(reg !== emg, `regular abort vs emergency abort: distinct labels`);
}

// 26. End-to-end: pause → verified → resume → stop → idle
{
  let s: SafetyState = { kind: 'running' };
  s = transitionFromSafetyResult(s, r({ action: 'pause', motionState: 'paused' }), 1000);
  assert(s.kind === 'pausedVerified', `flow: pause+confirmed → pausedVerified`);
  s = transitionFromSafetyResult(s, r({ action: 'resume' }), 2000);
  assert(s.kind === 'running', `flow: resume → running`);
  s = transitionFromSafetyResult(s,
    r({ action: 'stop', motionState: 'stopped', positionTrusted: true }), 3000);
  assert(s.kind === 'safeIdle', `flow: clean stop → safeIdle`);
}

// 27. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/SafetyStateMachine.ts'), 'utf-8');
  assert(/T2-44/.test(src), 'T2-44 marker in SafetyStateMachine.ts');
  for (const id of [
    'SafetyState', 'SafetyAction', 'SafetyResultLike',
    'safetyStateInitial', 'transitionFromSafetyResult',
    'safetyStateBlocksAllCommands', 'safetyStateAllowsStartJob',
    'safetyStateAllowsResume', 'safetyStateRequiresRehome',
    'clearToSafeIdle', 'safetyStateLabel',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of [
    'safeIdle', 'running', 'pauseRequested', 'pausedVerified',
    'abortRequested', 'emergencyStopping', 'stoppedPositionUnknown',
    'laserOffCommandedUnknown', 'unsafeUnknown', 'requiresInspection',
  ]) {
    assert(src.includes(`'${k}'`), `state kind '${k}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

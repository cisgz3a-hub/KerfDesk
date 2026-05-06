/**
 * T2-12: canonical `MachineSafetyState` discriminated union. Pre-T2-12
 * the codebase had safety fields scattered across MachineState.status,
 * laserOutputState (T1-22), unsafePriorState (T1-29), activeOperation
 * (T2-11) — UI gates derived "can the user click this?" from ad-hoc
 * combinations. Audit 1E central architectural gap.
 *
 * Run: npx tsx tests/machine-safety-state.test.ts
 */
import {
  computeMachineSafetyState,
  safetyStateAllowsStartJob,
  safetyStateAllowsEmergencyStop,
  safetyStateAllowsResume,
  safetyStateRequiresInspection,
  safetyStateLabel,
  type SafetyStateInputs,
  type MachineSafetyState,
  type MachineSafetyStateKind,
} from '../src/app/MachineSafetyState';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-12 MachineSafetyState ===\n');

function baseInputs(): SafetyStateInputs {
  return {
    connected: true,
    controllerStatus: 'idle',
    laserOutput: 'OFF_CONFIRMED',
    activeOperation: { kind: 'idle' },
    isConnecting: false,
    isSafetyProbing: false,
    isStopping: false,
    isEmergencyStopping: false,
    fault: null,
    alarmCode: null,
    disconnectSafety: 'NEVER_CONNECTED',
  };
}

void (async () => {

// 1. Disconnected, never connected → DISCONNECTED_UNKNOWN
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    connected: false,
    disconnectSafety: 'NEVER_CONNECTED',
  });
  assert(s.kind === 'DISCONNECTED_UNKNOWN', `disconnect/never → DISCONNECTED_UNKNOWN`);
}

// 2. Disconnected after safe shutdown → DISCONNECTED_SAFE
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    connected: false,
    disconnectSafety: 'SAFE_SHUTDOWN_CONFIRMED',
  });
  assert(s.kind === 'DISCONNECTED_SAFE', `safe disconnect → DISCONNECTED_SAFE`);
}

// 3. Disconnected mid-job → DISCONNECTED_UNSAFE with reason
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    connected: false,
    disconnectSafety: 'CLOSED_DURING_ACTIVE_OPERATION',
  });
  assert(s.kind === 'DISCONNECTED_UNSAFE',
    `mid-job disconnect → DISCONNECTED_UNSAFE`);
  if (s.kind === 'DISCONNECTED_UNSAFE') {
    assert(s.reason === 'CLOSED_DURING_ACTIVE_OPERATION',
      `reason carried (got ${s.reason})`);
  }
}

// 4. CONNECTING during handshake
{
  const s = computeMachineSafetyState({ ...baseInputs(), isConnecting: true });
  assert(s.kind === 'CONNECTING', `isConnecting=true → CONNECTING`);
}

// 5. SAFETY_PROBING during T1-25 probe
{
  const s = computeMachineSafetyState({ ...baseInputs(), isSafetyProbing: true });
  assert(s.kind === 'SAFETY_PROBING', `isSafetyProbing=true → SAFETY_PROBING`);
}

// 6. FAULTED_REQUIRES_INSPECTION when fault set
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    fault: { errorCode: 9, cause: 'G-code lock' },
  });
  assert(s.kind === 'FAULTED_REQUIRES_INSPECTION',
    `fault → FAULTED_REQUIRES_INSPECTION`);
  if (s.kind === 'FAULTED_REQUIRES_INSPECTION') {
    assert(s.errorCode === 9 && s.cause === 'G-code lock',
      `error metadata carried`);
  }
}

// 7. ALARM_UNKNOWN with alarmCode
{
  const s = computeMachineSafetyState({ ...baseInputs(), alarmCode: 1 });
  assert(s.kind === 'ALARM_UNKNOWN', `alarmCode → ALARM_UNKNOWN`);
  if (s.kind === 'ALARM_UNKNOWN') {
    assert(s.alarmCode === 1, `alarmCode carried`);
  }
}

// 8. EMERGENCY_STOPPING in flight
{
  const s = computeMachineSafetyState({ ...baseInputs(), isEmergencyStopping: true });
  assert(s.kind === 'EMERGENCY_STOPPING', `EMERGENCY_STOPPING`);
}

// 9. STOPPING in flight (when not e-stop)
{
  const s = computeMachineSafetyState({ ...baseInputs(), isStopping: true });
  assert(s.kind === 'STOPPING', `STOPPING`);
}

// 10. HOLD_SAFE when controller=hold + laser confirmed off
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    controllerStatus: 'hold',
    laserOutput: 'OFF_CONFIRMED',
  });
  assert(s.kind === 'HOLD_SAFE', `hold + OFF_CONFIRMED → HOLD_SAFE`);
}

// 11. HOLD_UNKNOWN when controller=hold + laser unverified
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    controllerStatus: 'hold',
    laserOutput: 'OFF_COMMANDED_UNVERIFIED',
  });
  assert(s.kind === 'HOLD_UNKNOWN', `hold + unverified → HOLD_UNKNOWN`);
}

// 12. Door triggers HOLD too
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    controllerStatus: 'door',
    laserOutput: 'OFF_CONFIRMED',
  });
  assert(s.kind === 'HOLD_SAFE', `door + OFF_CONFIRMED → HOLD_SAFE`);
}

// 13. RUNNING_JOB via activeOperation.kind=job
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    activeOperation: { kind: 'job', ticketId: 't1', sessionId: 7 },
  });
  assert(s.kind === 'RUNNING_JOB', `activeOperation.job → RUNNING_JOB`);
  if (s.kind === 'RUNNING_JOB') {
    assert(s.ticketId === 't1' && s.sessionId === 7, `ticket+session carried`);
  }
}

// 14. RUNNING_JOB via controllerStatus=run
{
  const s = computeMachineSafetyState({ ...baseInputs(), controllerStatus: 'run' });
  assert(s.kind === 'RUNNING_JOB', `controllerStatus=run → RUNNING_JOB`);
}

// 15. RUNNING_TEMP_LASER for testFire / frameDot / frameSafe / autoFocus / jog
{
  for (const op of ['testFire', 'frameDot', 'frameSafe', 'autoFocus', 'jog'] as const) {
    const s = computeMachineSafetyState({
      ...baseInputs(),
      activeOperation: { kind: op },
    });
    assert(s.kind === 'RUNNING_TEMP_LASER',
      `activeOperation.${op} → RUNNING_TEMP_LASER`);
    if (s.kind === 'RUNNING_TEMP_LASER') {
      assert(s.operation === op, `operation field carried (got ${s.operation})`);
    }
  }
}

// 16. IDLE_SAFE: idle + OFF_CONFIRMED
{
  const s = computeMachineSafetyState(baseInputs());
  assert(s.kind === 'IDLE_SAFE', `default base → IDLE_SAFE`);
}

// 17. IDLE_UNKNOWN: idle + UNKNOWN laser
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    laserOutput: 'UNKNOWN',
  });
  assert(s.kind === 'IDLE_UNKNOWN', `idle + UNKNOWN → IDLE_UNKNOWN`);
}

// 18. CONNECTED_UNKNOWN catch-all: jog state without active operation
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    controllerStatus: 'jog',
    activeOperation: { kind: 'idle' },
  });
  assert(s.kind === 'CONNECTED_UNKNOWN',
    `controllerStatus=jog without activeOperation → CONNECTED_UNKNOWN`);
}

// 19. safetyStateAllowsStartJob: only IDLE_SAFE → true
{
  const allowedKinds: MachineSafetyStateKind[] = ['IDLE_SAFE'];
  const states: MachineSafetyState[] = [
    { kind: 'DISCONNECTED_UNKNOWN' },
    { kind: 'IDLE_SAFE' },
    { kind: 'IDLE_UNKNOWN' },
    { kind: 'RUNNING_JOB' },
    { kind: 'HOLD_SAFE' },
    { kind: 'ALARM_UNKNOWN', alarmCode: 1 },
  ];
  for (const s of states) {
    const expected = allowedKinds.includes(s.kind);
    assert(safetyStateAllowsStartJob(s) === expected,
      `allowsStartJob('${s.kind}') === ${expected}`);
  }
}

// 20. safetyStateAllowsEmergencyStop: blocked only when DISCONNECTED_*
{
  const states: Array<[MachineSafetyState, boolean]> = [
    [{ kind: 'DISCONNECTED_UNKNOWN' }, false],
    [{ kind: 'DISCONNECTED_SAFE' }, false],
    [{ kind: 'DISCONNECTED_UNSAFE', reason: 'CLOSED_DURING_ACTIVE_OPERATION' }, false],
    [{ kind: 'CONNECTING' }, true],
    [{ kind: 'IDLE_SAFE' }, true],
    [{ kind: 'RUNNING_JOB' }, true],
    [{ kind: 'ALARM_UNKNOWN', alarmCode: 1 }, true],
    [{ kind: 'FAULTED_REQUIRES_INSPECTION', errorCode: 1, cause: 'x' }, true],
  ];
  for (const [s, expected] of states) {
    assert(safetyStateAllowsEmergencyStop(s) === expected,
      `allowsEmergencyStop('${s.kind}') === ${expected}`);
  }
}

// 21. safetyStateAllowsResume: only HOLD_*
{
  const yes: MachineSafetyState[] = [{ kind: 'HOLD_SAFE' }, { kind: 'HOLD_UNKNOWN' }];
  const no: MachineSafetyState[] = [
    { kind: 'IDLE_SAFE' },
    { kind: 'RUNNING_JOB' },
    { kind: 'STOPPING' },
    { kind: 'ALARM_UNKNOWN', alarmCode: 1 },
  ];
  for (const s of yes) {
    assert(safetyStateAllowsResume(s), `Resume allowed in ${s.kind}`);
  }
  for (const s of no) {
    assert(!safetyStateAllowsResume(s), `Resume blocked in ${s.kind}`);
  }
}

// 22. safetyStateRequiresInspection
{
  assert(safetyStateRequiresInspection({ kind: 'FAULTED_REQUIRES_INSPECTION', errorCode: 1, cause: 'x' }),
    `FAULTED → requires inspection`);
  assert(safetyStateRequiresInspection({ kind: 'UNSAFE_UNKNOWN', reason: 'x' }),
    `UNSAFE_UNKNOWN → requires inspection`);
  assert(safetyStateRequiresInspection({ kind: 'DISCONNECTED_UNSAFE', reason: 'CLOSED_DURING_ACTIVE_OPERATION' }),
    `DISCONNECTED_UNSAFE during active op → requires inspection`);
  assert(!safetyStateRequiresInspection({ kind: 'DISCONNECTED_UNSAFE', reason: 'CLOSED_DURING_IDLE_UNVERIFIED' }),
    `DISCONNECTED_UNSAFE during idle does NOT require inspection`);
  assert(!safetyStateRequiresInspection({ kind: 'IDLE_SAFE' }),
    `IDLE_SAFE does NOT require inspection`);
}

// 23. safetyStateLabel: every kind has a non-empty label
{
  const all: MachineSafetyState[] = [
    { kind: 'DISCONNECTED_UNKNOWN' },
    { kind: 'DISCONNECTED_SAFE' },
    { kind: 'DISCONNECTED_UNSAFE', reason: 'NEVER_CONNECTED' },
    { kind: 'CONNECTING' },
    { kind: 'CONNECTED_UNKNOWN' },
    { kind: 'SAFETY_PROBING' },
    { kind: 'IDLE_SAFE' },
    { kind: 'IDLE_UNKNOWN' },
    { kind: 'RUNNING_JOB' },
    { kind: 'RUNNING_TEMP_LASER', operation: 'testFire' },
    { kind: 'HOLD_UNKNOWN' },
    { kind: 'HOLD_SAFE' },
    { kind: 'STOPPING' },
    { kind: 'EMERGENCY_STOPPING' },
    { kind: 'ALARM_UNKNOWN', alarmCode: 1 },
    { kind: 'FAULTED_REQUIRES_INSPECTION', errorCode: 1, cause: 'x' },
    { kind: 'UNSAFE_UNKNOWN', reason: 'unverified' },
  ];
  const labels = new Set<string>();
  for (const s of all) {
    const l = safetyStateLabel(s);
    assert(l.length > 0, `${s.kind}: non-empty label`);
    labels.add(l);
  }
  assert(labels.size === all.length || labels.size === all.length - 1,
    `every kind has a unique-or-near-unique label (got ${labels.size} unique of ${all.length})`);
}

// 24. Order: fault overrides controllerStatus=run
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    controllerStatus: 'run',
    fault: { errorCode: 9, cause: 'lock' },
  });
  assert(s.kind === 'FAULTED_REQUIRES_INSPECTION',
    `fault overrides run`);
}

// 25. Order: connect/probe override fault (the connect handshake comes first)
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    isConnecting: true,
    fault: { errorCode: 9, cause: 'lock' },
  });
  assert(s.kind === 'CONNECTING',
    `isConnecting wins over fault`);
}

// 26. Order: e-stop overrides hold
{
  const s = computeMachineSafetyState({
    ...baseInputs(),
    controllerStatus: 'hold',
    isEmergencyStopping: true,
  });
  assert(s.kind === 'EMERGENCY_STOPPING',
    `EMERGENCY_STOPPING wins over hold`);
}

// 27. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/MachineSafetyState.ts'), 'utf-8');
  assert(/T2-12/.test(src), 'T2-12 marker in MachineSafetyState.ts');
  for (const id of [
    'MachineSafetyState', 'LaserOutputState', 'DisconnectSafety',
    'ActiveOperation', 'computeMachineSafetyState',
    'safetyStateAllowsStartJob', 'safetyStateAllowsEmergencyStop',
    'safetyStateAllowsResume', 'safetyStateRequiresInspection',
    'safetyStateLabel',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const k of [
    'DISCONNECTED_UNKNOWN', 'DISCONNECTED_SAFE', 'DISCONNECTED_UNSAFE',
    'CONNECTING', 'CONNECTED_UNKNOWN', 'SAFETY_PROBING',
    'IDLE_SAFE', 'IDLE_UNKNOWN',
    'RUNNING_JOB', 'RUNNING_TEMP_LASER',
    'HOLD_UNKNOWN', 'HOLD_SAFE',
    'STOPPING', 'EMERGENCY_STOPPING',
    'ALARM_UNKNOWN', 'FAULTED_REQUIRES_INSPECTION', 'UNSAFE_UNKNOWN',
  ]) {
    assert(src.includes(`'${k}'`), `state kind '${k}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

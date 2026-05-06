/**
 * T2-57: typed error state per domain. Pre-T2-57 errors were
 * `console.warn` / `appendMessage` / `showAlert` — no code could ask
 * "is connection currently in failed state?" because messages were a
 * flat array. Audit 4A Error-state findings.
 *
 * Run: npx tsx tests/typed-error-domains.test.ts
 */
import {
  initialDomainErrorState,
  setCompileError,
  clearCompileError,
  setConnectionStatus,
  setConnectionError,
  setJobError,
  clearJobError,
  setMachineAlarm,
  clearMachineAlarm,
  resetDomainErrorState,
  selectHasAnyError,
  selectCanStartJob,
  selectCanConnect,
  selectCanRetryCompile,
  describeError,
  type CompileError,
  type ConnectionError,
  type JobError,
  type MachineAlarm,
} from '../src/app/DomainErrorState';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-57 Domain error state ===\n');

void (async () => {

// 1. Initial state: all errors null, connection 'disconnected'
{
  const s = initialDomainErrorState;
  assert(s.compile.error === null, `compile.error null`);
  assert(s.connection.error === null, `connection.error null`);
  assert(s.connection.status === 'disconnected', `connection.status='disconnected'`);
  assert(s.job.error === null, `job.error null`);
  assert(s.machine.alarm === null, `machine.alarm null`);
  assert(!selectHasAnyError(s), `no error active`);
}

// 2. Initial state: cannot start job (not connected)
{
  assert(!selectCanStartJob(initialDomainErrorState),
    `disconnected → cannot start`);
}

// 3. setCompileError + clearCompileError
{
  const err: CompileError = {
    kind: 'profile-mismatch', message: 'Profile changed', retryable: true, occurredAt: 100,
  };
  let s = setCompileError(initialDomainErrorState, err);
  assert(s.compile.error?.kind === 'profile-mismatch', `compile error set`);
  assert(selectHasAnyError(s), `selectHasAnyError sees compile error`);
  s = clearCompileError(s);
  assert(s.compile.error === null, `compile error cleared`);
}

// 4. setConnectionStatus 'connecting' clears prior error
{
  let s = setConnectionError(initialDomainErrorState,
    { kind: 'open-failed', message: 'COM3 busy', retryable: true, occurredAt: 100 });
  s = setConnectionStatus(s, 'connecting');
  assert(s.connection.error === null, `connecting → error cleared`);
  assert(s.connection.status === 'connecting', `status='connecting'`);
}

// 5. setConnectionStatus 'connected' clears prior error
{
  let s = setConnectionError(initialDomainErrorState,
    { kind: 'open-failed', message: 'x', retryable: true, occurredAt: 100 });
  s = setConnectionStatus(s, 'connected');
  assert(s.connection.error === null, `connected → error cleared`);
}

// 6. setConnectionError sets status to 'failed'
{
  const s = setConnectionError(initialDomainErrorState,
    { kind: 'permission-denied', message: 'denied', retryable: false, occurredAt: 0 });
  assert(s.connection.status === 'failed', `error → status='failed'`);
  assert(s.connection.error?.kind === 'permission-denied', `kind carried`);
}

// 7. setConnectionError(null) preserves status
{
  let s = setConnectionStatus(initialDomainErrorState, 'connected');
  s = setConnectionError(s, null);
  assert(s.connection.status === 'connected',
    `setConnectionError(null) preserves status`);
}

// 8. selectCanConnect: retryable error allows reconnect
{
  const retryable = setConnectionError(initialDomainErrorState,
    { kind: 'cable-pulled', message: 'cable', retryable: true, occurredAt: 0 });
  assert(selectCanConnect(retryable), `retryable error: can reconnect`);

  const notRetryable = setConnectionError(initialDomainErrorState,
    { kind: 'permission-denied', message: 'denied', retryable: false, occurredAt: 0 });
  assert(!selectCanConnect(notRetryable),
    `non-retryable error: connect blocked`);
}

// 9. job error set + clear
{
  const err: JobError = {
    kind: 'firmware-alarm', message: 'alarm 1', alarmCode: 1, occurredAt: 0,
  };
  let s = setJobError(initialDomainErrorState, err);
  assert(s.job.error?.alarmCode === 1, `alarmCode carried`);
  s = clearJobError(s);
  assert(s.job.error === null, `cleared`);
}

// 10. machine alarm set + clear
{
  const alarm: MachineAlarm = { code: 1, message: 'hard limit', occurredAt: 0 };
  let s = setMachineAlarm(initialDomainErrorState, alarm);
  assert(s.machine.alarm?.code === 1, `alarm set`);
  s = clearMachineAlarm(s);
  assert(s.machine.alarm === null, `alarm cleared`);
}

// 11. resetDomainErrorState
{
  let s = setCompileError(initialDomainErrorState,
    { kind: 'no-objects', message: 'x', retryable: false, occurredAt: 0 });
  s = resetDomainErrorState();
  assert(!selectHasAnyError(s), `reset → all clean`);
}

// 12. **CONCRETE FAILURE PREVENTED**: connection failure + Start
//     attempt — selectCanStartJob says NO, even though there's no
//     active job error (the pre-T2-57 gap).
{
  const failed = setConnectionError(initialDomainErrorState,
    { kind: 'open-failed', message: 'x', retryable: true, occurredAt: 0 });
  assert(!selectCanStartJob(failed),
    `connection failed → cannot start (the pre-T2-57 gap closed)`);
}

// 13. selectCanStartJob: requires all clean + connected
{
  const conn = setConnectionStatus(initialDomainErrorState, 'connected');
  assert(selectCanStartJob(conn),
    `connected + no errors → can start`);

  const compileBlocked = setCompileError(conn,
    { kind: 'no-objects', message: 'x', retryable: false, occurredAt: 0 });
  assert(!selectCanStartJob(compileBlocked),
    `compile error blocks start`);

  const machineBlocked = setMachineAlarm(conn,
    { code: 1, message: 'limit', occurredAt: 0 });
  assert(!selectCanStartJob(machineBlocked),
    `machine alarm blocks start`);
}

// 14. selectCanRetryCompile
{
  const retryable = setCompileError(initialDomainErrorState,
    { kind: 'pipeline-error', message: 'transient', retryable: true, occurredAt: 0 });
  assert(selectCanRetryCompile(retryable),
    `retryable compile error → can retry`);

  const fatal = setCompileError(initialDomainErrorState,
    { kind: 'no-objects', message: 'x', retryable: false, occurredAt: 0 });
  assert(!selectCanRetryCompile(fatal),
    `non-retryable compile error → blocked until fix`);
}

// 15. Most-recent-wins per domain
{
  const e1: CompileError = { kind: 'profile-mismatch', message: 'first', retryable: true, occurredAt: 100 };
  const e2: CompileError = { kind: 'no-objects', message: 'second', retryable: false, occurredAt: 200 };
  let s = setCompileError(initialDomainErrorState, e1);
  s = setCompileError(s, e2);
  assert(s.compile.error?.kind === 'no-objects',
    `second error overwrites first`);
}

// 16. describeError per kind
{
  assert(describeError({ kind: 'profile-mismatch', message: 'x', retryable: true, occurredAt: 0 } as CompileError)
    === '[profile-mismatch] x',
    `compile describe`);
  assert(describeError({ kind: 'open-failed', message: 'COM3', retryable: true, occurredAt: 0 } as ConnectionError)
    === '[open-failed] COM3',
    `connection describe`);
  assert(describeError({ kind: 'firmware-alarm', message: 'alarm 1', occurredAt: 0 } as JobError)
    === '[firmware-alarm] alarm 1',
    `job describe`);
  assert(describeError({ code: 1, message: 'hard limit', occurredAt: 0 } as MachineAlarm)
    === '[alarm:1] hard limit',
    `machine alarm describe with code`);
}

// 17. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/DomainErrorState.ts'), 'utf-8');
  assert(/T2-57/.test(src), 'T2-57 marker in DomainErrorState.ts');
  for (const id of [
    'CompileError', 'ConnectionError', 'JobError', 'MachineAlarm',
    'DomainErrorState', 'initialDomainErrorState',
    'setCompileError', 'clearCompileError',
    'setConnectionStatus', 'setConnectionError',
    'setJobError', 'clearJobError',
    'setMachineAlarm', 'clearMachineAlarm',
    'resetDomainErrorState',
    'selectHasAnyError', 'selectCanStartJob',
    'selectCanConnect', 'selectCanRetryCompile',
    'describeError',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

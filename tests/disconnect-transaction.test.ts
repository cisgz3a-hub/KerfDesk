/**
 * T2-54: unified disconnect transaction. Pre-T2-54 disconnect was
 * implemented in 7+ places with inconsistent cleanup.
 *
 * Run: npx tsx tests/disconnect-transaction.test.ts
 */
import {
  planDisconnectSteps,
  runDisconnectTransaction,
  disconnectWasClean,
  describeDisconnectResult,
  type DisconnectOptions,
  type DisconnectStep,
  type DisconnectAdapters,
} from '../src/app/DisconnectTransaction';
import type { SafetyActionResult } from '../src/app/SafetyActionResult';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-54 unified disconnect transaction ===\n');

const okResult = (action: SafetyActionResult['action']): SafetyActionResult => ({
  action, accepted: true,
  motionState: 'stopped', laserState: 'commandedOff',
  positionTrusted: false, requiresRehome: true,
  requiresReconnect: false, requiresInspection: false,
  timestamp: 0,
});

const refusedResult = (action: SafetyActionResult['action']): SafetyActionResult => ({
  action, accepted: false,
  motionState: 'unknown', laserState: 'unknown',
  positionTrusted: 'unknown', requiresRehome: 'unknown',
  requiresReconnect: false, requiresInspection: false,
  timestamp: 0,
});

const verifiedLaserOff = (): SafetyActionResult => ({
  action: 'laserOff', accepted: true,
  motionState: 'stopped', laserState: 'off',
  positionTrusted: true, requiresRehome: false,
  requiresReconnect: false, requiresInspection: false,
  timestamp: 0,
});

void (async () => {

// 1. planDisconnectSteps: stop-if-running + isRunning → stop step present
{
  const steps = planDisconnectSteps({
    options: { reason: 'toolbar', stopPolicy: 'stop-if-running' },
    isJobRunning: true,
  });
  assert(steps[0] === 'stop', `stop is first step`);
  assert(steps.length === 4, `4 steps total`);
  assert(steps.includes('laser-off') && steps.includes('close-transport') &&
         steps.includes('clear-session'), `core 3 steps always present`);
}

// 2. planDisconnectSteps: stop-if-running + NOT running → no stop step
{
  const steps = planDisconnectSteps({
    options: { reason: 'panel', stopPolicy: 'stop-if-running' },
    isJobRunning: false,
  });
  assert(!steps.includes('stop'), `idle: no stop step`);
  assert(steps.length === 3, `only 3 steps`);
}

// 3. planDisconnectSteps: skip-stop never adds stop step
{
  const a = planDisconnectSteps({
    options: { reason: 'toolbar', stopPolicy: 'skip-stop' },
    isJobRunning: true,
  });
  assert(!a.includes('stop'), `skip-stop excludes stop even while running`);
}

// 4. planDisconnectSteps: emergency-stop policy → e-stop step (regardless of running)
{
  const a = planDisconnectSteps({
    options: { reason: 'error', stopPolicy: 'emergency-stop' },
    isJobRunning: false,
  });
  assert(a[0] === 'emergency-stop', `e-stop step present even when idle`);
  const b = planDisconnectSteps({
    options: { reason: 'error', stopPolicy: 'emergency-stop' },
    isJobRunning: true,
  });
  assert(b[0] === 'emergency-stop', `e-stop step present when running`);
}

// 5. Step ordering canonical
{
  const steps = planDisconnectSteps({
    options: { reason: 'toolbar', stopPolicy: 'stop-if-running' },
    isJobRunning: true,
  });
  const expected: DisconnectStep[] = ['stop', 'laser-off', 'close-transport', 'clear-session'];
  for (let i = 0; i < expected.length; i++) {
    assert(steps[i] === expected[i], `step ${i} = ${expected[i]}`);
  }
}

// 6. runDisconnectTransaction: full clean disconnect
{
  let cleared = false;
  const adapters: DisconnectAdapters = {
    isJobRunning: () => false,
    laserOff: async () => verifiedLaserOff(),
    closeTransport: async () => { /* ok */ },
    clearSession: () => { cleared = true; },
  };
  const result = await runDisconnectTransaction(
    { reason: 'toolbar', stopPolicy: 'stop-if-running' },
    adapters,
  );
  assert(result.errors.length === 0, `no errors`);
  assert(result.laserOffSent, `laserOffSent`);
  assert(result.laserOffVerified === true, `verified off`);
  assert(result.portClosed, `port closed`);
  assert(!result.stopAttempted, `idle path: no stop attempt`);
  assert(cleared, `clearSession ran`);
  assert(disconnectWasClean(result), `clean`);
}

// 7. runDisconnectTransaction: stop-if-running while running calls abortJob
{
  let abortCalled = 0;
  const adapters: DisconnectAdapters = {
    isJobRunning: () => true,
    abortJob: async () => { abortCalled++; return okResult('abortJob'); },
    laserOff: async () => verifiedLaserOff(),
    closeTransport: async () => {},
    clearSession: () => {},
  };
  const result = await runDisconnectTransaction(
    { reason: 'toolbar', stopPolicy: 'stop-if-running' },
    adapters,
  );
  assert(abortCalled === 1, `abortJob called once`);
  assert(result.stopAttempted, `stopAttempted=true`);
  assert(result.jobAborted, `jobAborted=true (accepted)`);
}

// 8. runDisconnectTransaction: stop refused → stopAttempted=true, jobAborted=false
{
  const adapters: DisconnectAdapters = {
    isJobRunning: () => true,
    abortJob: async () => refusedResult('abortJob'),
    laserOff: async () => verifiedLaserOff(),
    closeTransport: async () => {},
    clearSession: () => {},
  };
  const result = await runDisconnectTransaction(
    { reason: 'toolbar', stopPolicy: 'stop-if-running' },
    adapters,
  );
  assert(result.stopAttempted, `attempted`);
  assert(!result.jobAborted, `not aborted (refused)`);
  // honest reporting per audit
}

// 9. runDisconnectTransaction: emergency-stop calls emergencyStop adapter
{
  let estopCalled = 0;
  let abortCalled = 0;
  const adapters: DisconnectAdapters = {
    isJobRunning: () => true,
    abortJob: async () => { abortCalled++; return okResult('abortJob'); },
    emergencyStop: async () => { estopCalled++; return okResult('emergencyStop'); },
    laserOff: async () => verifiedLaserOff(),
    closeTransport: async () => {},
    clearSession: () => {},
  };
  await runDisconnectTransaction(
    { reason: 'error', stopPolicy: 'emergency-stop' },
    adapters,
  );
  assert(estopCalled === 1, `emergencyStop called`);
  assert(abortCalled === 0, `abortJob NOT called`);
}

// 10. runDisconnectTransaction: laserOff returns 'commandedOff' → verified='unknown'
{
  const adapters: DisconnectAdapters = {
    isJobRunning: () => false,
    laserOff: async () => okResult('laserOff'),  // laserState='commandedOff'
    closeTransport: async () => {},
    clearSession: () => {},
  };
  const result = await runDisconnectTransaction(
    { reason: 'panel', stopPolicy: 'stop-if-running' }, adapters,
  );
  assert(result.laserOffVerified === 'unknown', `commandedOff → unknown`);
}

// 11. runDisconnectTransaction: laserOff returns 'unknown' → verified=false
{
  const adapters: DisconnectAdapters = {
    isJobRunning: () => false,
    laserOff: async () => refusedResult('laserOff'),
    closeTransport: async () => {},
    clearSession: () => {},
  };
  const result = await runDisconnectTransaction(
    { reason: 'panel', stopPolicy: 'stop-if-running' }, adapters,
  );
  assert(result.laserOffVerified === false, `refused/unknown → false`);
}

// 12. runDisconnectTransaction: close-transport throws → recorded but later steps still run
{
  let cleared = false;
  const adapters: DisconnectAdapters = {
    isJobRunning: () => false,
    laserOff: async () => verifiedLaserOff(),
    closeTransport: async () => { throw new Error('port stuck'); },
    clearSession: () => { cleared = true; },
  };
  const result = await runDisconnectTransaction(
    { reason: 'panel', stopPolicy: 'stop-if-running' }, adapters,
  );
  assert(result.errors.length === 1, `1 error captured`);
  assert(result.errors[0].message === 'port stuck', `error message preserved`);
  assert(!result.portClosed, `portClosed=false (it threw)`);
  assert(cleared, `clearSession still ran after close threw`);
}

// 13. runDisconnectTransaction: missing abortJob adapter when needed → recorded
{
  const adapters: DisconnectAdapters = {
    isJobRunning: () => true,
    laserOff: async () => verifiedLaserOff(),
    closeTransport: async () => {},
    clearSession: () => {},
    // abortJob deliberately missing
  };
  const result = await runDisconnectTransaction(
    { reason: 'toolbar', stopPolicy: 'stop-if-running' }, adapters,
  );
  assert(result.errors.some(e => e.message.includes('abortJob')),
    `missing-adapter error recorded`);
}

// 14. THE audit's headline: toolbar disconnect during running NEVER skips stop
{
  let stopCalled = 0;
  const adapters: DisconnectAdapters = {
    isJobRunning: () => true,
    abortJob: async () => { stopCalled++; return okResult('abortJob'); },
    laserOff: async () => verifiedLaserOff(),
    closeTransport: async () => {},
    clearSession: () => {},
  };
  const result = await runDisconnectTransaction(
    { reason: 'toolbar', stopPolicy: 'stop-if-running' }, adapters,
  );
  assert(stopCalled === 1, `audit case: stop runs on toolbar disconnect during job`);
  assert(result.jobAborted, `aborted`);
}

// 15. disconnectWasClean: errors → not clean
{
  const adapters: DisconnectAdapters = {
    isJobRunning: () => false,
    laserOff: async () => verifiedLaserOff(),
    closeTransport: async () => { throw new Error('e'); },
    clearSession: () => {},
  };
  const result = await runDisconnectTransaction(
    { reason: 'panel', stopPolicy: 'stop-if-running' }, adapters,
  );
  assert(!disconnectWasClean(result), `errors → not clean`);
}

// 16. describeDisconnectResult: clean disconnect with abort
{
  const adapters: DisconnectAdapters = {
    isJobRunning: () => true,
    abortJob: async () => okResult('abortJob'),
    laserOff: async () => verifiedLaserOff(),
    closeTransport: async () => {},
    clearSession: () => {},
  };
  const result = await runDisconnectTransaction(
    { reason: 'toolbar', stopPolicy: 'stop-if-running' }, adapters,
  );
  const msg = describeDisconnectResult(result);
  assert(msg.includes('aborted'), `clean+aborted message names abort`);
}

// 17. describeDisconnectResult: with errors lists issues
{
  const adapters: DisconnectAdapters = {
    isJobRunning: () => false,
    laserOff: async () => verifiedLaserOff(),
    closeTransport: async () => { throw new Error('e'); },
    clearSession: () => {},
  };
  const result = await runDisconnectTransaction(
    { reason: 'panel', stopPolicy: 'stop-if-running' }, adapters,
  );
  const msg = describeDisconnectResult(result);
  assert(msg.toLowerCase().includes('issue'), `issues in message`);
  assert(msg.includes('error'), `error count in message`);
}

// 18. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/DisconnectTransaction.ts'), 'utf-8');
  assert(/T2-54/.test(src), 'T2-54 marker');
  for (const id of [
    'DisconnectReason', 'StopPolicy', 'DisconnectOptions',
    'DisconnectResult', 'DisconnectStep', 'DisconnectAdapters',
    'planDisconnectSteps', 'runDisconnectTransaction',
    'disconnectWasClean', 'describeDisconnectResult',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const r of ['toolbar', 'panel', 'beforeunload', 'error', 'profile-switch']) {
    assert(src.includes(`'${r}'`), `reason '${r}' declared`);
  }
  for (const p of ['stop-if-running', 'skip-stop', 'emergency-stop']) {
    assert(src.includes(`'${p}'`), `policy '${p}' declared`);
  }
  for (const s of ['stop', 'laser-off', 'close-transport', 'clear-session']) {
    assert(src.includes(`'${s}'`), `step '${s}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

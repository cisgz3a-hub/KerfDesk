/**
 * T1-198 (extends T1-195): wire `MachineService.notifyLaserSafetyOutcome`
 * into the MachineEventLedger so support bundles can reconstruct the
 * full safety-action history without depending on console.warn
 * capture.
 *
 * Background:
 *   - T1-22 introduced `notifyLaserSafetyOutcome(stage)` which moves
 *     the in-memory `_laserOutputState` between `'off'` and
 *     `'unknown'` based on the structured outcome of
 *     `LaserController.safetyOff()`.
 *   - T1-193 / T1-195 introduced the `MachineEventLedger` with a
 *     declared `safety-off` event kind, but `notifyLaserSafetyOutcome`
 *     wasn't writing to it — the only observability was a
 *     console.warn. A renderer crash or a missed dev-tools session
 *     erased the history.
 *   - T1-198 wires the append so the stage ('m5' | 'soft-reset' |
 *     'failed') reaches the persistent ledger every time
 *     notifyLaserSafetyOutcome runs.
 *
 * Run: npx tsx tests/machine-event-ledger-safety-off-wiring.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InMemoryMachineEventLedger,
  _setMachineEventLedgerForTest,
} from '../src/app/MachineEventLedger';
import { MachineService } from '../src/app/MachineService';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));

const memoryStore: Record<string, string> = {};
function installMockLocalStorage(): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() { return Object.keys(memoryStore).length; },
    clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
    getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
    key: (i: number) => Object.keys(memoryStore)[i] ?? null,
    removeItem: (k: string) => { delete memoryStore[k]; },
    setItem: (k: string, v: string) => { memoryStore[k] = v; },
  } as Storage;
}
function resetMemoryStore(): void {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
}

const idle: MachineState = {
  status: 'idle',
  position: { x: 0, y: 0, z: 0 },
  feedRate: 0,
  spindleSpeed: 0,
  alarmCode: null,
  errorCode: null,
};

function makeController(): LaserController {
  return {
    family: 'grbl' as const,
    protocolName: 'mock',
    state: { ...idle },
    isJobRunning: false,
    maxSpindle: null,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
    sendCommand: () => {},
    requestStatusReport: () => {},
    onStateChange: () => () => {},
    onProgress: () => () => {},
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    operations: {
      jog: async () => ({ ok: true }),
      home: async () => ({ ok: true }),
      unlockAlarm: async () => ({ ok: true }),
      setWorkOriginAtCurrentPosition: async () => ({ ok: true }),
      resetWcsToMachineOrigin: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => ({ ok: true }),
    },
  } as unknown as LaserController;
}

function buildService(ctrl: LaserController): MachineService {
  const portRef: { current: SerialPortLike | null } = { current: {} as SerialPortLike };
  return new MachineService({ current: ctrl }, portRef);
}

console.log('\n=== T1-198 MachineEventLedger safety-off wiring ===\n');

installMockLocalStorage();

// -------- 1. 'm5' outcome appends safety-off event with stage='m5' --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController());
  svc.notifyLaserSafetyOutcome('m5');
  const events = ledger.query({ kinds: new Set(['safety-off']) });
  assert(events.length === 1, "'m5' outcome: 1 event appended");
  if (events.length === 1 && events[0].kind === 'safety-off') {
    assert(events[0].stage === 'm5', "event.stage === 'm5'");
    assert(typeof events[0].t === 'number' && events[0].t > 0, 'event has timestamp');
  }
}

// -------- 2. 'soft-reset' outcome appends with stage='soft-reset' --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController());
  svc.notifyLaserSafetyOutcome('soft-reset');
  const events = ledger.query({ kinds: new Set(['safety-off']) });
  assert(events.length === 1, "'soft-reset' outcome: 1 event appended");
  if (events.length === 1 && events[0].kind === 'safety-off') {
    assert(events[0].stage === 'soft-reset', "event.stage === 'soft-reset'");
  }
}

// -------- 3. 'failed' outcome appends with stage='failed' --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController());
  svc.notifyLaserSafetyOutcome('failed');
  const events = ledger.query({ kinds: new Set(['safety-off']) });
  assert(events.length === 1, "'failed' outcome: 1 event appended");
  if (events.length === 1 && events[0].kind === 'safety-off') {
    assert(events[0].stage === 'failed', "event.stage === 'failed'");
  }
}

// -------- 4. Multiple outcomes accumulate in order --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController());
  svc.notifyLaserSafetyOutcome('m5');
  svc.notifyLaserSafetyOutcome('m5');
  svc.notifyLaserSafetyOutcome('soft-reset');
  svc.notifyLaserSafetyOutcome('failed');
  const events = ledger.query({ kinds: new Set(['safety-off']) });
  assert(events.length === 4, `4 events appended (got ${events.length})`);
  const stages = events
    .filter((e): e is Extract<typeof e, { kind: 'safety-off' }> => e.kind === 'safety-off')
    .map(e => e.stage);
  assert(
    stages[0] === 'm5' && stages[1] === 'm5' && stages[2] === 'soft-reset' && stages[3] === 'failed',
    'stages recorded in invocation order',
  );
}

// -------- 5. Side effect: 'm5' still drives _laserOutputState → 'off' --------
// 'failed' / 'soft-reset' still flip _laserOutputState → 'unknown'. The
// T1-198 wiring is observability-only and must NOT change the existing
// safety-state-machine behaviour.
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController());
  // We can't read _laserOutputState directly (it's private), but we
  // can pin via the documented effect: a 'failed' outcome triggers
  // the recovery checklist (see T1-122 / T1-22 wiring). The recovery
  // state is exposed via getRecoveryState().
  const beforeRecovery = svc.getRecoveryState();
  svc.notifyLaserSafetyOutcome('failed');
  const afterRecovery = svc.getRecoveryState();
  // The recovery state changes from idle → an active recovery (kind
  // depends on implementation). We assert the state changed at all
  // — proving notifyLaserSafetyOutcome's existing side-effects are
  // intact post-T1-198.
  assert(
    JSON.stringify(beforeRecovery) !== JSON.stringify(afterRecovery),
    'notifyLaserSafetyOutcome side-effects still fire (recovery state changes on failed outcome)',
  );
}

// -------- 6. Source pins --------
{
  const src = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');
  assert(/T1-198/.test(src), 'MachineService.ts carries T1-198 marker');
  // The ledger append must be inside notifyLaserSafetyOutcome, before
  // the m5 / non-m5 branch. Grep for the append in the immediate
  // vicinity of the method.
  const methodStart = src.indexOf('notifyLaserSafetyOutcome(stage:');
  assert(methodStart > 0, 'notifyLaserSafetyOutcome method exists');
  const methodEnd = src.indexOf('\n  }', methodStart);
  const methodBody = src.slice(methodStart, methodEnd);
  assert(
    /getMachineEventLedger\(\)\.append\(\{\s*kind:\s*'safety-off'/.test(methodBody),
    'notifyLaserSafetyOutcome appends safety-off event',
  );
  assert(
    /stage,/.test(methodBody),
    'append payload passes stage through',
  );
  // The append must run BEFORE the stage branch so the ledger
  // records every invocation regardless of whether the m5 happy path
  // fires or the failed/soft-reset path raises 'unknown'.
  const appendIdx = methodBody.indexOf("kind: 'safety-off'");
  const branchIdx = methodBody.indexOf("if (stage === 'm5')");
  assert(appendIdx > 0 && branchIdx > 0 && appendIdx < branchIdx, 'append precedes the stage branch');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

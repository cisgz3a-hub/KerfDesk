/**
 * T1-201 (extends T1-200): wire `MachineService.acknowledgeRecoveryComplete`
 * into the MachineEventLedger as a `recovery-cleared` event with
 * `acknowledgedBy: 'user'`.
 *
 * Pre-T1-201 the `recovery-cleared` event kind was declared in
 * T1-193's MachineEvent union (with a `'user' | 'auto'`
 * acknowledgedBy discriminant) but had no writer. T1-201 wires the
 * 'user' path — the only path that exists in production today. The
 * 'auto' path (per-step checklist completion → state machine
 * transitions to 'none' via checkRecoveryComplete) is intentionally
 * deferred until the step-ack call sites land.
 *
 * Specific behaviour pinned:
 *   - acknowledgeRecoveryComplete from a non-'none' recovery state
 *     appends exactly one recovery-cleared event.
 *   - acknowledgeRecoveryComplete from an already-'none' state does
 *     NOT append (no-op respected).
 *   - The append precedes the state transition so the ledger entry
 *     exists even if a listener callback throws.
 *
 * Run: npx tsx tests/machine-event-ledger-recovery-cleared-wiring.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InMemoryMachineEventLedger,
  _setMachineEventLedgerForTest,
} from '../src/app/MachineEventLedger';
import { MachineService } from '../src/app/MachineService';
import { triggerEmergencyStop } from '../src/runtime/RecoveryState';
// T1-219 (v30 audit #4): acknowledgeRecoveryComplete now requires
// an UnsafeRecoveryBypassToken when an active recovery is in flight.
import { createUnsafeRecoveryBypassToken } from '../src/app/RecoveryBypassToken';

const TEST_BYPASS_TOKEN = createUnsafeRecoveryBypassToken(
  'test fixture: T1-201 / T1-219 recovery-cleared wiring test'
);
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

console.log('\n=== T1-201 MachineEventLedger recovery-cleared wiring ===\n');

installMockLocalStorage();

// -------- 1. acknowledgeRecoveryComplete from active recovery
//             appends recovery-cleared --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController());
  // Move into an active recovery state via the public test path: use
  // notifyLaserSafetyOutcome('failed') which (per T1-198 path) flips
  // recovery into the emergency-stop checklist.
  svc.notifyLaserSafetyOutcome('failed');
  const beforeAck = svc.getRecoveryState().status;
  assert(beforeAck !== 'none', 'precondition: recovery state is non-none before ack');

  ledger.clear();
  svc.acknowledgeRecoveryComplete(TEST_BYPASS_TOKEN);
  const events = ledger.query({ kinds: new Set(['recovery-cleared']) });
  assert(events.length === 1, 'recovery-cleared event appended');
  if (events.length === 1 && events[0].kind === 'recovery-cleared') {
    assert(events[0].acknowledgedBy === 'user', "acknowledgedBy === 'user'");
    assert(typeof events[0].t === 'number' && events[0].t > 0, 'event has timestamp');
  }
  assert(svc.getRecoveryState().status === 'none', 'recovery state transitioned to none');
}

// -------- 2. acknowledgeRecoveryComplete from 'none' state is a
//             no-op (no event appended) --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController());
  // The default initial recovery state IS 'none'. Calling ack from
  // here should NOT emit a ledger event.
  assert(svc.getRecoveryState().status === 'none', 'precondition: initial recovery state is none');
  svc.acknowledgeRecoveryComplete(TEST_BYPASS_TOKEN);
  const events = ledger.query({ kinds: new Set(['recovery-cleared']) });
  assert(events.length === 0, 'no recovery-cleared event when ack is a no-op');
}

// -------- 3. Multiple acks from active recovery accumulate correctly --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController());
  svc.notifyLaserSafetyOutcome('failed');
  svc.acknowledgeRecoveryComplete(TEST_BYPASS_TOKEN);
  // Second invocation from 'none' is a no-op.
  svc.acknowledgeRecoveryComplete(TEST_BYPASS_TOKEN);
  // Third: re-enter recovery, then clear.
  svc.notifyLaserSafetyOutcome('failed');
  svc.acknowledgeRecoveryComplete(TEST_BYPASS_TOKEN);
  const events = ledger.query({ kinds: new Set(['recovery-cleared']) });
  assert(events.length === 2, '2 recovery-cleared events accumulated (one no-op skipped)');
  const allUser = events
    .filter((e): e is Extract<typeof e, { kind: 'recovery-cleared' }> => e.kind === 'recovery-cleared')
    .every(e => e.acknowledgedBy === 'user');
  assert(allUser, "all acknowledgedBy === 'user'");
}

// Silence unused-import lint (triggerEmergencyStop is referenced via
// the notifyLaserSafetyOutcome path; importing it pins the type
// surface but it isn't called directly here).
void triggerEmergencyStop;

// -------- 4. Source pins --------
{
  const src = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');
  assert(/T1-201/.test(src), 'MachineService.ts carries T1-201 marker');

  const methodIdx = src.indexOf('acknowledgeRecoveryComplete():');
  const methodEnd = src.indexOf('\n  }', methodIdx);
  const methodBody = src.slice(methodIdx, methodEnd);
  assert(
    /getMachineEventLedger\(\)\.append\(\{\s*kind:\s*'recovery-cleared'/.test(methodBody),
    'acknowledgeRecoveryComplete appends recovery-cleared event',
  );
  assert(
    /acknowledgedBy:\s*'user'/.test(methodBody),
    'event payload carries acknowledgedBy: user',
  );
  // The append must be inside the "current state is not 'none'"
  // guard so a redundant ack is a no-op.
  const guardIdx = methodBody.indexOf("this._recoveryState.status !== 'none'");
  assert(guardIdx > 0, 'append guarded by current-state !== none check');
  // The append must precede the _setRecoveryState transition so the
  // ledger captures the clear even if a listener throws.
  const appendIdx = methodBody.indexOf("kind: 'recovery-cleared'");
  const setStateIdx = methodBody.indexOf("this._setRecoveryState({ status: 'none' })");
  assert(
    appendIdx > 0 && setStateIdx > 0 && appendIdx < setStateIdx,
    'recovery-cleared append precedes _setRecoveryState transition',
  );
}

// -------- 5. MachineEvent union still declares the kind --------
{
  const ledgerSrc = readFileSync(resolve(here, '../src/app/MachineEventLedger.ts'), 'utf-8');
  assert(/kind:\s*'recovery-cleared'/.test(ledgerSrc), "MachineEvent declares 'recovery-cleared'");
  assert(
    /acknowledgedBy:\s*'user'\s*\|\s*'auto'/.test(ledgerSrc),
    "MachineEvent recovery-cleared still has 'user' | 'auto' discriminant",
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

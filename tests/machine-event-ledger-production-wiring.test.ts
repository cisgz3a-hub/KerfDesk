/**
 * T1-195 (extends T1-193): wire the MachineEventLedger singleton
 * into the first production callers.
 *
 * Sites wired in this slice:
 *   1. `MachineService.disconnect()` — appends `disconnect-while-
 *      running` when the unsafe-prior-state flag is preserved
 *      (T1-175 path).
 *   2. `MachineService.emergencyStop()` — appends `emergency-stop`
 *      with the SafetyActionResult `accepted` / `message` payload
 *      (T1-175 path).
 *   3. `MachineService.startValidatedJob()` catch — appends
 *      `failed-to-start` with the captured `(sawRun,
 *      controllerThinksRunning)` tuple (T1-176 path).
 *   4. `PipelineService.compileGcode()` — appends
 *      `burn-envelope-divergence` when T1-188's check returns
 *      non-null.
 *
 * Sites intentionally NOT wired in T1-195:
 *   - `GrblController._handleLine` WCS-query-error branch. The
 *     controller layer is lower in the dependency graph than the
 *     ledger; introducing an app → controllers reverse dependency
 *     would violate the existing layered design. A future arc
 *     either: (a) injects a ledger writer into the controller via
 *     constructor, or (b) raises the event up to a service-level
 *     listener that writes to the ledger.
 *
 * Run: npx tsx tests/machine-event-ledger-production-wiring.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InMemoryMachineEventLedger,
  _setMachineEventLedgerForTest,
  getMachineEventLedger,
  type MachineEvent,
} from '../src/app/MachineEventLedger';
import { MachineService } from '../src/app/MachineService';
import { setUnsafePriorState } from '../src/app/unsafePriorState';
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

function makeController(opts: { isJobRunning: boolean }): LaserController {
  return {
    family: 'grbl' as const,
    protocolName: 'mock',
    state: { ...idle },
    isJobRunning: opts.isJobRunning,
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

console.log('\n=== T1-195 MachineEventLedger production wiring ===\n');

installMockLocalStorage();
// Suppress the audit-grade warns from the production paths so the
// test output stays focused on the ledger assertions.
const origWarn = console.warn;
console.warn = () => {};

void (async () => {
  // -------- 1. disconnect-while-running appends event --------
  {
    const ledger = new InMemoryMachineEventLedger();
    _setMachineEventLedgerForTest(ledger);
    resetMemoryStore();
    setUnsafePriorState({ kind: 'job-running', ticketId: 'tkt-1', startedAt: Date.now() });
    const ctrl = makeController({ isJobRunning: true });
    const svc = buildService(ctrl);
    await svc.disconnect();

    const events = ledger.query({ kinds: new Set(['disconnect-while-running']) });
    assert(events.length === 1, 'disconnect-while-running: 1 event appended');
    if (events.length === 1 && events[0].kind === 'disconnect-while-running') {
      assert(typeof events[0].t === 'number' && events[0].t > 0, 'event has timestamp');
    }
  }

  // -------- 2. disconnect from idle (no running job): NO event --------
  {
    const ledger = new InMemoryMachineEventLedger();
    _setMachineEventLedgerForTest(ledger);
    resetMemoryStore();
    setUnsafePriorState({ kind: 'job-running', ticketId: 'tkt-2', startedAt: Date.now() });
    const ctrl = makeController({ isJobRunning: false });
    const svc = buildService(ctrl);
    await svc.disconnect();
    const events = ledger.query({ kinds: new Set(['disconnect-while-running']) });
    assert(events.length === 0, 'disconnect from idle: no disconnect-while-running event');
  }

  // -------- 3. emergency-stop appends event with accepted+message --------
  {
    const ledger = new InMemoryMachineEventLedger();
    _setMachineEventLedgerForTest(ledger);
    resetMemoryStore();
    const ctrl = makeController({ isJobRunning: false });
    const svc = buildService(ctrl);
    await svc.emergencyStop();

    const events = ledger.query({ kinds: new Set(['emergency-stop']) });
    assert(events.length === 1, 'emergency-stop: 1 event appended');
    if (events[0].kind === 'emergency-stop') {
      assert(typeof events[0].accepted === 'boolean', 'event carries accepted flag');
    }
  }

  // -------- 4. Test-only setter resets the singleton cleanly --------
  {
    _setMachineEventLedgerForTest(null);
    const fresh1 = getMachineEventLedger();
    const fresh2 = getMachineEventLedger();
    assert(fresh1 === fresh2, 'singleton: subsequent calls return the same instance');
    _setMachineEventLedgerForTest(null); // reset for other tests
  }

  // -------- 5. Source pins on the wiring --------
  {
    const svcSrc = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');
    assert(/T1-195/.test(svcSrc), 'MachineService.ts carries T1-195 marker');
    assert(
      /import \{ getMachineEventLedger \} from '\.\/MachineEventLedger'/.test(svcSrc),
      'MachineService imports the ledger singleton',
    );
    // 3 expected production wire points in MachineService.
    const appendCount = (svcSrc.match(/getMachineEventLedger\(\)\.append\(/g) ?? []).length;
    assert(appendCount === 3, `MachineService appends to the ledger 3 times (got ${appendCount})`);

    const pipelineSrc = readFileSync(resolve(here, '../src/app/PipelineService.ts'), 'utf-8');
    assert(/T1-195/.test(pipelineSrc), 'PipelineService.ts carries T1-195 marker');
    assert(
      /getMachineEventLedger\(\)\.append\(\{\s*kind:\s*'burn-envelope-divergence'/.test(pipelineSrc),
      'PipelineService appends burn-envelope-divergence event',
    );

    // Ledger has the singleton accessor.
    const ledgerSrc = readFileSync(resolve(here, '../src/app/MachineEventLedger.ts'), 'utf-8');
    assert(/T1-195/.test(ledgerSrc), 'MachineEventLedger.ts carries T1-195 marker');
    assert(/export function getMachineEventLedger\(\)/.test(ledgerSrc), 'singleton accessor exported');
    assert(
      /export function _setMachineEventLedgerForTest/.test(ledgerSrc),
      'test-only setter exported',
    );
  }

  console.warn = origWarn;
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.warn = origWarn;
  console.error(err);
  process.exit(1);
});

// Silence unused-import lint.
void ({} as MachineEvent);

/**
 * T1-175 (external audit Critical #2 + #3): the unsafe-prior-state
 * recovery flag must NOT be cleared by `MachineService.emergencyStop`,
 * and must NOT be cleared by `MachineService.disconnect` when a job
 * was running.
 *
 * Pre-T1-175 the unsafePriorState flag — set by `startValidatedJob`
 * at job-begin time and read on next launch to trigger the recovery
 * dialog — was unconditionally cleared in the finally clauses of
 * BOTH `disconnect()` and `emergencyStop()`. The T1-29 reasoning was
 * "user-initiated disconnect is a clean shutdown path."
 *
 * The audit (response received 2026-05-11) pushed back: clicking
 * disconnect or emergencyStop is intentional, but it doesn't make
 * the physical state safe. After E-stop the workpiece is partly
 * burnt, the head is at an intermediate position, the material
 * needs inspection. After disconnect mid-job the same applies.
 *
 * Post-T1-175:
 *  - `disconnect()` clears the flag ONLY when `ctrl.isJobRunning` was
 *    false at entry (preserves the T1-29 clean-disconnect-from-idle
 *    behavior for the common case).
 *  - `emergencyStop()` NEVER clears the flag — by definition this is
 *    an unsafe physical interruption.
 *
 * Run: npx tsx tests/unsafe-state-survives-disconnect-and-estop.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MachineService } from '../src/app/MachineService';
import {
  setUnsafePriorState,
  getUnsafePriorState,
  clearUnsafePriorState,
  UNSAFE_PRIOR_STATE_KEY_FOR_TESTS,
} from '../src/app/unsafePriorState';
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

/** Install a minimal in-memory localStorage so unsafePriorState helpers work. */
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

function setFlag(): void {
  setUnsafePriorState({
    kind: 'job-running',
    ticketId: 'test-ticket',
    startedAt: Date.now(),
  });
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
    // family='grbl' ensures `controllerDisconnectStopsJob` returns
    // true so disconnect proceeds through the finally clause (where
    // the T1-175 fix lives). Without it, disconnect is gated by
    // _guardDisconnectStopsJob and the finally never runs.
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

console.log('\n=== T1-175 unsafe-prior-state survives disconnect + emergencyStop (audit Critical #2 + #3) ===\n');

installMockLocalStorage();

// Capture ALL console.warn invocations so the assertions can search
// for the T1-175 message regardless of how many other warns the
// disconnect / E-stop path emits (notifyLaserSafetyOutcome, etc.).
const origWarn = console.warn;
let capturedWarns: string[] = [];
function resetWarns(): void { capturedWarns = []; }
function warnsContain(re: RegExp): boolean {
  return capturedWarns.some(w => re.test(w));
}
console.warn = (...args: unknown[]) => {
  capturedWarns.push(args.map(String).join(' '));
};

void (async () => {
  // -------- 1. disconnect from IDLE clears the flag (regression bait — T1-29 path preserved) --------
  {
    resetMemoryStore();
    setFlag();
    assert(getUnsafePriorState() !== null, 'pre: flag set');
    const ctrl = makeController({ isJobRunning: false });
    const svc = buildService(ctrl);
    await svc.disconnect();
    assert(
      getUnsafePriorState() === null,
      'disconnect from idle controller: flag is CLEARED (T1-29 clean-shutdown path preserved)',
    );
  }

  // -------- 2. CRITICAL #3: disconnect while job WAS running preserves the flag --------
  {
    resetMemoryStore();
    setFlag();
    assert(getUnsafePriorState() !== null, 'pre: flag set');
    resetWarns();
    const ctrl = makeController({ isJobRunning: true });
    const svc = buildService(ctrl);
    await svc.disconnect();
    assert(
      getUnsafePriorState() !== null,
      'CRITICAL #3 invariant: disconnect WHILE JOB WAS RUNNING preserves the unsafe-prior-state flag',
    );
    assert(
      warnsContain(/T1-175.*disconnect while job was running/i),
      'disconnect emits an audit-grade warn when preserving the flag',
    );
  }

  // -------- 3. CRITICAL #2: emergencyStop ALWAYS preserves the flag --------
  {
    resetMemoryStore();
    setFlag();
    assert(getUnsafePriorState() !== null, 'pre: flag set');
    resetWarns();
    // Idle controller — even from idle, E-stop must preserve any flag.
    const ctrl = makeController({ isJobRunning: false });
    const svc = buildService(ctrl);
    await svc.emergencyStop();
    assert(
      getUnsafePriorState() !== null,
      'CRITICAL #2 invariant: emergencyStop preserves the unsafe-prior-state flag (regardless of job state)',
    );
    assert(
      warnsContain(/T1-175.*emergencyStop preserves/i),
      'emergencyStop emits an audit-grade warn when preserving the flag',
    );
  }

  // -------- 4. emergencyStop with running job ALSO preserves the flag --------
  {
    resetMemoryStore();
    setFlag();
    const ctrl = makeController({ isJobRunning: true });
    const svc = buildService(ctrl);
    await svc.emergencyStop();
    assert(
      getUnsafePriorState() !== null,
      'emergencyStop with running job: flag is preserved (covers the common case)',
    );
  }

  // -------- 5. emergencyStop from idle with NO flag set: no-op (no false flag creation) --------
  {
    resetMemoryStore();
    clearUnsafePriorState();
    assert(getUnsafePriorState() === null, 'pre: flag NOT set');
    const ctrl = makeController({ isJobRunning: false });
    const svc = buildService(ctrl);
    await svc.emergencyStop();
    assert(
      getUnsafePriorState() === null,
      'emergencyStop from idle with no prior flag: still no flag (no false flag creation)',
    );
  }

  // -------- 6. Source pins on the implementation --------
  {
    const src = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');
    assert(/T1-175/.test(src), 'MachineService.ts carries T1-175 marker');
    assert(
      /audit Critical #2|external audit Critical #2/.test(src),
      'MachineService.ts cross-references audit Critical #2',
    );
    assert(
      /audit Critical #3|external audit Critical #3/.test(src),
      'MachineService.ts cross-references audit Critical #3',
    );
    // disconnect captures wasJobRunning at entry.
    assert(
      /const wasJobRunning = ctrl\?\.isJobRunning === true/.test(src),
      'disconnect() captures wasJobRunning at entry',
    );
    // disconnect clearUnsafePriorState is gated on !wasJobRunning.
    assert(
      /if \(!wasJobRunning\) \{\s*clearUnsafePriorState\(\);/.test(src),
      'disconnect() gates clearUnsafePriorState() on !wasJobRunning',
    );
    // emergencyStop has NO clearUnsafePriorState() call.
    // Match the emergencyStop body and confirm clearUnsafePriorState is absent.
    const emergencyBody = src.match(/async emergencyStop\(\)[\s\S]*?\n  \}/);
    assert(
      emergencyBody !== null,
      'emergencyStop body extracted for inspection',
    );
    if (emergencyBody) {
      assert(
        !/clearUnsafePriorState\(\)/.test(emergencyBody[0]),
        'CRITICAL #2: emergencyStop body NO longer calls clearUnsafePriorState()',
      );
    }
  }

  console.warn = origWarn;
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.warn = origWarn;
  console.error(err);
  process.exit(1);
});

// Reference the test-only key export so it isn't tree-shaken from the
// production build. (Not needed at runtime but documents the boundary.)
void UNSAFE_PRIOR_STATE_KEY_FOR_TESTS;

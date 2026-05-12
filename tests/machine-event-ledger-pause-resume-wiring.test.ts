/**
 * T1-200 (extends T1-195 / T1-198 / T1-199): wire pause-requested,
 * paused-verified, and resume-requested into the MachineEventLedger.
 *
 * Sites wired in this slice:
 *   1. `MachineService.pause()` — appends `pause-requested` at entry
 *      (before the controller-null guard) and `paused-verified` after
 *      `ctrl.operations.pauseJob()` returns `{ ok: true }`.
 *   2. `MachineService.resume()` — appends `resume-requested` at entry.
 *
 * The (pause-requested, paused-verified) pair is the support-bundle
 * diagnostic: a request without a matching verification means feed-
 * hold didn't take. There's deliberately no `resume-verified` event —
 * a missed resume keeps the job paused, which is the safe default.
 *
 * Run: npx tsx tests/machine-event-ledger-pause-resume-wiring.test.ts
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

function makeController(opts: { pauseOk: boolean; resumeOk: boolean }): LaserController {
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
      pauseJob: async () => opts.pauseOk ? { ok: true } : { ok: false, reason: 'pause refused' },
      resumeJob: async () => opts.resumeOk ? { ok: true } : { ok: false, reason: 'resume refused' },
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => ({ ok: true }),
    },
  } as unknown as LaserController;
}

function buildService(ctrl: LaserController | null): MachineService {
  const portRef: { current: SerialPortLike | null } = { current: {} as SerialPortLike };
  // The controllerRef type expects `current: LaserController` but the
  // production code reads `this.controllerRef.current` and checks for
  // null inline, so the runtime correctly handles a null current. The
  // cast keeps the type system in sync with that intent.
  return new MachineService({ current: ctrl } as { current: LaserController }, portRef);
}

console.log('\n=== T1-200 MachineEventLedger pause/resume wiring ===\n');

installMockLocalStorage();

void (async () => {
// -------- 1. Happy path: pause request + verified pair --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController({ pauseOk: true, resumeOk: true }));
  await svc.pause();
  const requested = ledger.query({ kinds: new Set(['pause-requested']) });
  const verified = ledger.query({ kinds: new Set(['paused-verified']) });
  assert(requested.length === 1, 'pause(): 1 pause-requested event appended');
  assert(verified.length === 1, 'pause(): 1 paused-verified event appended');
  if (requested.length === 1 && verified.length === 1) {
    assert(requested[0].t <= verified[0].t, 'pause-requested timestamp ≤ paused-verified timestamp');
  }
}

// -------- 2. Pause refused: requested appended, NO verified --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController({ pauseOk: false, resumeOk: true }));
  await svc.pause();
  const requested = ledger.query({ kinds: new Set(['pause-requested']) });
  const verified = ledger.query({ kinds: new Set(['paused-verified']) });
  assert(requested.length === 1, 'refused pause: pause-requested still appended');
  assert(verified.length === 0, 'refused pause: NO paused-verified event (asymmetry is the diagnostic)');
}

// -------- 3. No controller: requested appended, NO verified --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(null);
  await svc.pause();
  const requested = ledger.query({ kinds: new Set(['pause-requested']) });
  const verified = ledger.query({ kinds: new Set(['paused-verified']) });
  assert(requested.length === 1, 'no-controller pause: pause-requested still appended (request happened)');
  assert(verified.length === 0, 'no-controller pause: NO paused-verified (controller never confirmed)');
}

// -------- 4. Resume: resume-requested appended --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController({ pauseOk: true, resumeOk: true }));
  await svc.resume();
  const events = ledger.query({ kinds: new Set(['resume-requested']) });
  assert(events.length === 1, 'resume(): 1 resume-requested event appended');
}

// -------- 5. Resume with no controller: requested still appended --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(null);
  await svc.resume();
  const events = ledger.query({ kinds: new Set(['resume-requested']) });
  assert(events.length === 1, 'no-controller resume: resume-requested still appended');
}

// -------- 6. Multiple pauses accumulate paired events in order --------
{
  const ledger = new InMemoryMachineEventLedger();
  _setMachineEventLedgerForTest(ledger);
  resetMemoryStore();
  const svc = buildService(makeController({ pauseOk: true, resumeOk: true }));
  await svc.pause();
  await svc.resume();
  await svc.pause();
  await svc.resume();
  const requested = ledger.query({ kinds: new Set(['pause-requested']) });
  const verified = ledger.query({ kinds: new Set(['paused-verified']) });
  const resumeReq = ledger.query({ kinds: new Set(['resume-requested']) });
  assert(requested.length === 2, '2 pause-requested events');
  assert(verified.length === 2, '2 paused-verified events');
  assert(resumeReq.length === 2, '2 resume-requested events');
}

// -------- 7. Source pins --------
{
  const src = readFileSync(resolve(here, '../src/app/MachineService.ts'), 'utf-8');
  assert(/T1-200/.test(src), 'MachineService.ts carries T1-200 marker');

  const pauseIdx = src.indexOf('async pause(): Promise<SafetyActionResult>');
  const pauseEnd = src.indexOf('\n  }', pauseIdx);
  const pauseBody = src.slice(pauseIdx, pauseEnd);
  assert(
    /getMachineEventLedger\(\)\.append\(\{\s*kind:\s*'pause-requested'/.test(pauseBody),
    'pause() appends pause-requested',
  );
  assert(
    /getMachineEventLedger\(\)\.append\(\{\s*kind:\s*'paused-verified'/.test(pauseBody),
    'pause() appends paused-verified',
  );
  // pause-requested must run BEFORE the null-controller guard so even
  // a disconnected pause request reaches the ledger.
  const requestedIdx = pauseBody.indexOf("kind: 'pause-requested'");
  const guardIdx = pauseBody.indexOf('if (!ctrl)');
  assert(
    requestedIdx > 0 && guardIdx > 0 && requestedIdx < guardIdx,
    'pause-requested append precedes the controller-null guard',
  );
  // paused-verified must run AFTER the result.ok check.
  const verifiedIdx = pauseBody.indexOf("kind: 'paused-verified'");
  const okCheckIdx = pauseBody.indexOf('if (!result.ok)');
  assert(
    verifiedIdx > 0 && okCheckIdx > 0 && verifiedIdx > okCheckIdx,
    'paused-verified append fires only after the result.ok check passes',
  );

  const resumeIdx = src.indexOf('async resume(): Promise<SafetyActionResult>');
  const resumeEnd = src.indexOf('\n  }', resumeIdx);
  const resumeBody = src.slice(resumeIdx, resumeEnd);
  assert(
    /getMachineEventLedger\(\)\.append\(\{\s*kind:\s*'resume-requested'/.test(resumeBody),
    'resume() appends resume-requested',
  );
  // No resume-verified event yet (deliberate per the docstring).
  assert(
    !/kind:\s*'resume-verified'/.test(resumeBody),
    'resume() does NOT append a resume-verified event (deliberate; not in MachineEvent union)',
  );
}

// -------- 8. MachineEvent union still declares the three kinds --------
{
  const ledgerSrc = readFileSync(resolve(here, '../src/app/MachineEventLedger.ts'), 'utf-8');
  assert(/kind:\s*'pause-requested'/.test(ledgerSrc), "MachineEvent declares 'pause-requested'");
  assert(/kind:\s*'paused-verified'/.test(ledgerSrc), "MachineEvent declares 'paused-verified'");
  assert(/kind:\s*'resume-requested'/.test(ledgerSrc), "MachineEvent declares 'resume-requested'");
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

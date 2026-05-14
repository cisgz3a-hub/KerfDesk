/**
 * T2-41: typed `SafetyActionResult` return for safety methods.
 * Pre-T2-41 every safety method returned `void`; the audit (3D
 * Critical 1+6+P0) called for a structured outcome so the caller
 * could surface accept/motion/laser/position/rehome state to the
 * audit trail (T2-46), the recovery dialog gates (T2-62), and the
 * state machine (T2-44).
 *
 * This commit ships the type + a focused MVP migration on
 * `MachineService.stopAndEnsureLaserOff`. The other safety methods
 * (pause / resume / disconnect / emergencyStop) stay void; T2-41-
 * followup migrates them.
 *
 * Run: npx tsx tests/safety-action-result.test.ts
 */
import type { MutableRefObject } from 'react';
import { MachineService } from '../src/app/MachineService';
import {
  type SafetyAction,
  type SafetyActionResult,
  makeSoftResetStopResult,
  makeNotConnectedResult,
} from '../src/app/SafetyActionResult';
import { type LaserController, type MachineState } from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return Object.keys(memoryStore).length; },
  clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
  getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  removeItem: (k: string) => { delete memoryStore[k]; },
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
} as Storage;

const idle: MachineState = {
  status: 'idle', position: { x: 0, y: 0, z: 0 },
  feedRate: 0, spindleSpeed: 0, alarmCode: null, errorCode: null,
};

function acceptedSafety(action: SafetyAction): SafetyActionResult {
  return {
    action,
    accepted: true,
    motionState: 'unknown',
    laserState: 'unknown',
    positionTrusted: 'unknown',
    requiresRehome: 'unknown',
    requiresReconnect: false,
    requiresInspection: false,
    timestamp: Date.now(),
  };
}

function makeMockCtrl(): { ctrl: LaserController; rawStopCalls: { count: number }; operationStopCalls: { count: number } } {
  const stopCalls = { count: 0 };
  const operationStopCalls = { count: 0 };
  const ctrl: Partial<LaserController> = {
    state: idle,
    isJobRunning: false,
    maxSpindle: 1000,
    connect: async () => {},
    disconnect: async () => {},
    sendCommand: () => {},
    sendJob: async () => {},
    pause: async () => acceptedSafety('pause'),
    // T1-216: resume is async (awaits modal reassert).
    resume: async () => acceptedSafety('resume'),
    stop: () => { stopCalls.count++; return acceptedSafety('abortJob'); },
    emergencyStop: () => acceptedSafety('emergencyStop'),
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
      testFire: async () => ({ ok: true }),
      frame: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => {
        operationStopCalls.count++;
        return { ok: true };
      },
      emergencyStop: async () => ({ ok: true }),
    },
  };
  return { ctrl: ctrl as unknown as LaserController, rawStopCalls: stopCalls, operationStopCalls };
}

function makeService(ctrl: LaserController): MachineService {
  const portRef = { current: null } as { current: SerialPortLike | null };
  const ctrlRef = { current: ctrl } as { current: LaserController };
  return new MachineService(
    ctrlRef as MutableRefObject<LaserController>,
    portRef as MutableRefObject<SerialPortLike | null>,
  );
}

console.log('\n=== T2-41 SafetyActionResult typed return ===\n');

void (async () => {

// 1. makeSoftResetStopResult: GRBL soft-reset semantics
{
  const r = makeSoftResetStopResult();
  assert(r.action === 'abortJob', `softReset: action=abortJob (got ${r.action})`);
  assert(r.accepted === true, 'softReset: accepted=true');
  assert(r.motionState === 'stopped',
    `softReset: motionState=stopped (got ${r.motionState})`);
  assert(r.laserState === 'commandedOff',
    `softReset: laserState=commandedOff (GRBL spec: soft-reset forces laser off but no per-byte ack; got ${r.laserState})`);
  assert(r.positionTrusted === false,
    'softReset: positionTrusted=false (soft reset invalidates position)');
  assert(r.requiresRehome === true,
    'softReset: requiresRehome=true (user must $H before next job)');
  assert(r.requiresReconnect === false,
    'softReset: requiresReconnect=false (port stays open)');
  assert(r.requiresInspection === false,
    'softReset: requiresInspection=false (routine stop, not e-stop)');
  assert(typeof r.timestamp === 'number' && r.timestamp > 0,
    `softReset: timestamp populated (got ${r.timestamp})`);
  assert(typeof r.message === 'string' && /rehome/i.test(r.message ?? ''),
    `softReset: message names rehome (got "${r.message}")`);
}

// 2. makeSoftResetStopResult accepts a custom message
{
  const r = makeSoftResetStopResult('Custom audit-trail message');
  assert(r.message === 'Custom audit-trail message',
    'softReset: caller-supplied message overrides default');
}

// 3. makeNotConnectedResult: port-not-open semantics
{
  const r = makeNotConnectedResult('abortJob');
  assert(r.action === 'abortJob', `notConnected: action preserved (got ${r.action})`);
  assert(r.accepted === false, 'notConnected: accepted=false');
  assert(r.motionState === 'unknown',
    `notConnected: motionState=unknown (port closed; can't observe; got ${r.motionState})`);
  assert(r.laserState === 'unknown', 'notConnected: laserState=unknown');
  assert(r.positionTrusted === 'unknown',
    'notConnected: positionTrusted=unknown (tristate, not boolean)');
  assert(r.requiresRehome === 'unknown',
    'notConnected: requiresRehome=unknown (tristate)');
  assert(r.requiresReconnect === true,
    'notConnected: requiresReconnect=true (caller must reconnect first)');
  assert(typeof r.message === 'string' && /not connected/i.test(r.message ?? ''),
    `notConnected: message names port state (got "${r.message}")`);
}

// 4. makeNotConnectedResult: works for every safety action
{
  const actions = ['laserOff', 'pause', 'resume', 'abortJob', 'emergencyStop',
    'disconnectSafe', 'beginTestFire', 'endTestFire'] as const;
  let ok = true;
  for (const a of actions) {
    const r = makeNotConnectedResult(a);
    if (r.action !== a) { ok = false; break; }
  }
  assert(ok,
    'notConnected: action discriminator carries across all SafetyAction kinds');
}

// 5. MachineService.stopAndEnsureLaserOff returns SafetyActionResult
//    with soft-reset semantics
{
  const { ctrl, rawStopCalls, operationStopCalls } = makeMockCtrl();
  const svc = makeService(ctrl);
  const result: SafetyActionResult = await svc.stopAndEnsureLaserOff();
  assert(operationStopCalls.count === 1,
    `stopAndEnsureLaserOff: controller operations.stopJob called once (got ${operationStopCalls.count})`);
  assert(rawStopCalls.count === 0,
    `stopAndEnsureLaserOff: raw controller.stop not called by MachineService (got ${rawStopCalls.count})`);
  assert(result.action === 'abortJob',
    `stopAndEnsureLaserOff: result.action=abortJob (got ${result.action})`);
  assert(result.accepted === true,
    'stopAndEnsureLaserOff: result.accepted=true on the happy path');
  assert(result.requiresRehome === true,
    'stopAndEnsureLaserOff: requiresRehome=true (soft-reset semantics)');
  assert(result.positionTrusted === false,
    'stopAndEnsureLaserOff: positionTrusted=false');
  assert(typeof result.timestamp === 'number',
    'stopAndEnsureLaserOff: timestamp populated');
}

// 6. Existing void-await callers still work (the await throws away
//    the value; pre-T2-41 callers don't notice the type change)
{
  const { ctrl } = makeMockCtrl();
  const svc = makeService(ctrl);
  // Simulate a pre-T2-41 caller: `await svc.stopAndEnsureLaserOff()`
  // with no `const r =` assignment.
  let threw = false;
  try {
    await svc.stopAndEnsureLaserOff();
  } catch {
    threw = true;
  }
  assert(!threw,
    'pre-T2-41 callers: void-await pattern still works (no breakage)');
}

// 7. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/controllers/SafetyActionResult.ts'),
    'utf-8',
  );
  assert(/T2-41/.test(src), 'T2-41 marker in SafetyActionResult.ts');
  for (const a of ['laserOff', 'pause', 'resume', 'abortJob', 'emergencyStop',
    'disconnectSafe', 'beginTestFire', 'endTestFire']) {
    assert(src.includes(`'${a}'`),
      `SafetyAction includes '${a}'`);
  }
  assert(/export interface SafetyActionResult/.test(src),
    'SafetyActionResult interface exported');
  assert(/makeSoftResetStopResult/.test(src) && /makeNotConnectedResult/.test(src),
    'GRBL helper builders exported');

  const svcSrc = fs.readFileSync(
    path.resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(/T2-41/.test(svcSrc), 'T2-41 marker in MachineService.ts');
  assert(/Promise<SafetyActionResult>/.test(svcSrc),
    'stopAndEnsureLaserOff signature returns Promise<SafetyActionResult>');
  assert(/makeSoftResetStopResult\(\)/.test(svcSrc),
    'stopAndEnsureLaserOff body returns makeSoftResetStopResult()');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });

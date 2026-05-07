/**
 * T2-11: service-layer operation mutex prevents overlapping temporary-laser-on
 * operations. Two surfaces under test:
 *
 *   (1) MachineService.tryAcquireOperation / releaseOperation / getActiveOperation
 *       — the mutex API itself: acquire/release semantics, re-entry policy,
 *       idempotent release, mismatched-kind release warns.
 *   (2) ExecutionCoordinator integration — every temporary-laser-on entry
 *       point (jog, frame, frameDot, beginTestFire/endTestFire,
 *       autoFocus, setOriginAtCurrentPosition) acquires the mutex
 *       around its work and releases on every exit path including
 *       errors.
 *
 * Run: npx tsx tests/operation-mutex-prevents-overlap.test.ts
 */
import { MachineService } from '../src/app/MachineService';
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import {
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
import { type SerialPortLike } from '../src/communication/SerialPort';
import type { MutableRefObject } from 'react';

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

console.log('\n=== T2-11 service-layer operation mutex ===\n');

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length(): number { return Object.keys(memoryStore).length; },
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  getItem: (k: string) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
  removeItem: (k: string) => { delete memoryStore[k]; },
  clear: () => { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
};

async function run(): Promise<void> {

const idle: MachineState = {
  status: 'idle', position: { x: 0, y: 0, z: 0 },
  feedRate: 0, spindleSpeed: 0, alarmCode: null, errorCode: null,
};

function makeController(overrides?: Partial<LaserController>): LaserController {
  return {
    state: idle,
    isJobRunning: false,
    maxSpindle: 1000,
    connect: async () => {},
    disconnect: async () => {},
    sendCommand: () => {},
    sendJob: async () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    emergencyStop: () => {},
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
    ...overrides,
  } as LaserController;
}

function makeService(ctrl: LaserController): MachineService {
  const portRef = { current: null } as { current: SerialPortLike | null };
  const ctrlRef = { current: ctrl } as { current: LaserController };
  return new MachineService(
    ctrlRef as MutableRefObject<LaserController>,
    portRef as MutableRefObject<SerialPortLike | null>,
  );
}

// ─── Surface 1: mutex API on MachineService ───

// 1. Fresh service: getActiveOperation === null
{
  const svc = makeService(makeController());
  assert(svc.getActiveOperation() === null,
    'fresh service: getActiveOperation === null');
}

// 2. Acquire 'jog' → success; getActiveOperation reflects it
{
  const svc = makeService(makeController());
  const ok = svc.tryAcquireOperation('jog');
  assert(ok, 'tryAcquireOperation("jog") on fresh service returns true');
  const active = svc.getActiveOperation();
  assert(active != null && active.kind === 'jog',
    `getActiveOperation reflects 'jog' (got ${active?.kind})`);
  assert(typeof active?.startedAt === 'number' && active!.startedAt > 0,
    'startedAt is a positive number');
  assert(typeof active?.sessionId === 'number' && active!.sessionId > 0,
    'sessionId is a positive number');
}

// 3. Acquire 'jog' twice → second call still returns true (re-entry policy)
{
  const svc = makeService(makeController());
  svc.tryAcquireOperation('jog');
  const second = svc.tryAcquireOperation('jog');
  assert(second, 'same-kind re-acquire returns true (test-fire deadman re-entry preserved)');
}

// 4. Acquire 'jog', then try 'testFire' → second call returns false
{
  const svc = makeService(makeController());
  svc.tryAcquireOperation('jog');
  const second = svc.tryAcquireOperation('testFire');
  assert(!second, 'different-kind acquire returns false while jog held');
  const active = svc.getActiveOperation();
  assert(active?.kind === 'jog', 'jog kind preserved after rejected testFire acquire');
}

// 5. Release 'jog' → getActiveOperation === null
{
  const svc = makeService(makeController());
  svc.tryAcquireOperation('jog');
  svc.releaseOperation('jog');
  assert(svc.getActiveOperation() === null, 'release clears the mutex');
}

// 6. Release without acquire → no-op (idempotent)
{
  const svc = makeService(makeController());
  let threw = false;
  try { svc.releaseOperation('jog'); } catch { threw = true; }
  assert(!threw, 'release without prior acquire does not throw');
  assert(svc.getActiveOperation() === null, 'release without acquire leaves null');
}

// 7. Mismatched-kind release → warns, does NOT release the held kind
{
  const svc = makeService(makeController());
  svc.tryAcquireOperation('jog');
  const origWarn = console.warn;
  let warnedMessage: string | null = null;
  console.warn = (msg: string) => { warnedMessage = msg; };
  try {
    svc.releaseOperation('testFire');
  } finally {
    console.warn = origWarn;
  }
  assert(warnedMessage !== null && /releaseOperation/.test(warnedMessage),
    'mismatched-kind release emits a warn');
  assert(svc.getActiveOperation()?.kind === 'jog',
    'mismatched-kind release does NOT clear the held kind (jog still active)');
  svc.releaseOperation('jog');
}

// 8. Release returns to baseline; new acquire bumps sessionId
{
  const svc = makeService(makeController());
  svc.tryAcquireOperation('jog');
  const firstSession = svc.getActiveOperation()!.sessionId;
  svc.releaseOperation('jog');
  svc.tryAcquireOperation('frame');
  const secondSession = svc.getActiveOperation()!.sessionId;
  assert(secondSession > firstSession,
    `sessionId increases across acquire cycles (${firstSession} → ${secondSession})`);
  svc.releaseOperation('frame');
}

// 9. Same-kind re-acquire does NOT bump sessionId (re-entry preserves identity)
{
  const svc = makeService(makeController());
  svc.tryAcquireOperation('testFire');
  const firstSession = svc.getActiveOperation()!.sessionId;
  svc.tryAcquireOperation('testFire');
  const secondSession = svc.getActiveOperation()!.sessionId;
  assert(firstSession === secondSession,
    'same-kind re-acquire preserves sessionId (no churn for deadman re-entry)');
  svc.releaseOperation('testFire');
}

// ─── Surface 2: ExecutionCoordinator integration ───

function makeCoord(svc: MachineService, ctrl: LaserController): ExecutionCoordinator {
  return new ExecutionCoordinator({
    machineService: svc,
    controllerRef: { current: ctrl } as MutableRefObject<LaserController | null>,
    notifySimulatorRef: { current: () => {} },
  });
}

// 10. coord.jog acquires + releases (after awaited operation, mutex is free)
{
  const ctrl = makeController({ sendCommand: () => {} });
  const svc = makeService(ctrl);
  const coord = makeCoord(svc, ctrl);
  const r = await coord.jog('X', 5, 1500);
  assert(r.ok === true, 'jog succeeds when mutex is free');
  assert(svc.getActiveOperation() === null,
    'mutex released after awaited jog returns');
}

// 11. coord.jog refuses while another op holds the mutex
{
  const ctrl = makeController();
  const svc = makeService(ctrl);
  svc.tryAcquireOperation('testFire');  // simulate test-fire in flight
  const coord = makeCoord(svc, ctrl);
  const r = await coord.jog('X', 5, 1500);
  assert(r.ok === false && r.reason === 'operation-busy',
    'jog refuses with operation-busy when testFire is held');
  assert(svc.getActiveOperation()?.kind === 'testFire',
    'jog refusal does NOT release the holding kind');
  svc.releaseOperation('testFire');
}

// 12. coord.beginTestFire fails when another op holds the mutex
{
  const ctrl = makeController({ sendCommand: () => {} });
  const svc = makeService(ctrl);
  svc.tryAcquireOperation('frame');
  const coord = makeCoord(svc, ctrl);
  const ok = await coord.beginTestFire({ maxSpindle: 1000 });
  assert(ok === false, 'beginTestFire returns false when frame is held');
  assert(svc.getActiveOperation()?.kind === 'frame',
    'frame still held after beginTestFire refusal');
  svc.releaseOperation('frame');
}

// 13. coord.beginTestFire releases mutex on sendCommand throw
{
  const ctrl = makeController({
    sendCommand: () => { throw new Error('blocked'); },
  });
  const svc = makeService(ctrl);
  const coord = makeCoord(svc, ctrl);
  const ok = await coord.beginTestFire({ maxSpindle: 1000 });
  assert(ok === false, 'beginTestFire returns false on sendCommand throw');
  assert(svc.getActiveOperation() === null,
    'mutex released after failed beginTestFire start (no leak)');
}

// 14. coord.beginTestFire + coord.endTestFire releases the mutex
{
  const ctrl = makeController({ sendCommand: () => {} });
  const svc = makeService(ctrl);
  const coord = makeCoord(svc, ctrl);
  const ok = await coord.beginTestFire({ maxSpindle: 1000 });
  assert(ok, 'beginTestFire succeeds');
  assert(svc.getActiveOperation()?.kind === 'testFire',
    'testFire mutex held between begin and end');
  await coord.endTestFire();
  assert(svc.getActiveOperation() === null,
    'mutex released after endTestFire');
}

// 15. coord.autoFocus refuses when another op holds the mutex
{
  const ctrl = makeController();
  const svc = makeService(ctrl);
  svc.tryAcquireOperation('frameDot');
  const coord = makeCoord(svc, ctrl);
  const r = await coord.autoFocus();
  assert(r.ok === false && 'error' in r && /Another machine operation/.test(r.error),
    'autoFocus refuses with operation-in-progress message when frameDot is held');
  svc.releaseOperation('frameDot');
}

// 16. coord.setOriginAtCurrentPosition refuses while another op holds the mutex
{
  const ctrl = makeController({ sendCommand: () => {} });
  const svc = makeService(ctrl);
  svc.tryAcquireOperation('autoFocus');
  const coord = makeCoord(svc, ctrl);
  const r = await coord.setOriginAtCurrentPosition();
  assert(r.ok === false && r.reason === 'operation-busy',
    'setOriginAtCurrentPosition refuses with operation-busy when autoFocus is held');
  svc.releaseOperation('autoFocus');
}

// 17. Source-level pin: T2-11 markers in both files
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));

  const svcSrc = fs.readFileSync(
    path.resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(/T2-11/.test(svcSrc), 'T2-11 marker present in MachineService.ts');
  assert(/_activeOperation: ActiveOperationState \| null = null/.test(svcSrc),
    '_activeOperation field declared');
  assert(/tryAcquireOperation\(kind: ActiveOperationKind\): boolean/.test(svcSrc),
    'tryAcquireOperation public method declared');
  assert(/releaseOperation\(kind: ActiveOperationKind\): void/.test(svcSrc),
    'releaseOperation public method declared');
  assert(/getActiveOperation\(\): ActiveOperationState \| null/.test(svcSrc),
    'getActiveOperation public method declared');
  // ActiveOperationKind union shape — each member checked individually
  // since the multi-line union form (one `|` per line) doesn't match a
  // single-line regex.
  for (const kind of ['jog', 'frame', 'frameDot', 'testFire', 'autoFocus', 'setOrigin']) {
    assert(new RegExp(`\\| '${kind}'`).test(svcSrc),
      `ActiveOperationKind includes '${kind}'`);
  }

  const coordSrc = fs.readFileSync(
    path.resolve(here, '../src/app/ExecutionCoordinator.ts'),
    'utf-8',
  );
  assert(/T2-11/.test(coordSrc), 'T2-11 marker present in ExecutionCoordinator.ts');
  // Each operation entry calls tryAcquireOperation with the right kind.
  assert(/tryAcquireOperation\('jog'\)/.test(coordSrc), 'jog entry calls tryAcquireOperation("jog")');
  assert(/tryAcquireOperation\('testFire'\)/.test(coordSrc), 'beginTestFire calls tryAcquireOperation("testFire")');
  assert(/tryAcquireOperation\('autoFocus'\)/.test(coordSrc), 'autoFocus calls tryAcquireOperation("autoFocus")');
  assert(/tryAcquireOperation\('setOrigin'\)/.test(coordSrc), 'setOriginAtCurrentPosition calls tryAcquireOperation("setOrigin")');
  // runFrame uses the laserMode-conditional kind.
  assert(/laserMode === 'dot' \? 'frameDot' : 'frame'/.test(coordSrc),
    'runFrame picks frameDot vs frame mutex kind from laserMode');
  // FrameResult.reason union widened with operation-busy.
  assert(/'operation-busy'/.test(coordSrc),
    'FrameResult.reason union includes "operation-busy"');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

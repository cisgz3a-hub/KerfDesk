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
      testFire: async (args: { powerPercent: number; maxSpindle: number }) => {
        try {
          overrides?.sendCommand?.(`M3 S${Math.max(0, Math.round((args.powerPercent / 100) * args.maxSpindle))}`);
          return { ok: true };
        } catch (err) {
          return { ok: false, reason: err instanceof Error ? err.message : String(err) };
        }
      },
      frame: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => ({ ok: true }),
    },
    ...overrides,
  } as unknown as LaserController;
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
  const lease = svc.tryAcquireOperation('jog');
  assert(lease !== null, 'tryAcquireOperation("jog") on fresh service returns a lease');
  assert(lease?.kind === 'jog', `lease.kind === 'jog' (got ${lease?.kind})`);
  assert(typeof lease?.sessionId === 'number' && lease!.sessionId > 0,
    'lease.sessionId is a positive number');
  const active = svc.getActiveOperation();
  assert(active != null && active.kind === 'jog',
    `getActiveOperation reflects 'jog' (got ${active?.kind})`);
  assert(typeof active?.startedAt === 'number' && active!.startedAt > 0,
    'startedAt is a positive number');
  assert(active?.sessionId === lease?.sessionId,
    'getActiveOperation().sessionId matches the lease sessionId');
}

// 3. Acquire 'jog' twice → second call still returns a lease (re-entry policy)
{
  const svc = makeService(makeController());
  const first = svc.tryAcquireOperation('jog');
  const second = svc.tryAcquireOperation('jog');
  assert(first !== null && second !== null,
    'same-kind re-acquire returns a lease (deadman re-entry preserved)');
}

// 4. Acquire 'jog', then try 'testFire' → second call returns null
{
  const svc = makeService(makeController());
  svc.tryAcquireOperation('jog');
  const second = svc.tryAcquireOperation('testFire');
  assert(second === null, 'different-kind acquire returns null while jog held');
  const active = svc.getActiveOperation();
  assert(active?.kind === 'jog', 'jog kind preserved after rejected testFire acquire');
}

// 5. Release lease → getActiveOperation === null
{
  const svc = makeService(makeController());
  const lease = svc.tryAcquireOperation('jog')!;
  svc.releaseOperation(lease);
  assert(svc.getActiveOperation() === null, 'release clears the mutex');
}

// 6. Release without acquire → no-op (idempotent)
{
  const svc = makeService(makeController());
  let threw = false;
  // Hand-construct a fake lease (no acquire to mint a real one) and try to release.
  try { svc.releaseOperation({ kind: 'jog', sessionId: 999 }); } catch { threw = true; }
  assert(!threw, 'release without prior acquire does not throw');
  assert(svc.getActiveOperation() === null, 'release without acquire leaves null');
}

// 7. Stale lease release → silent no-op, does NOT clear the held kind
{
  // T1-222: this is the audit-flagged race. A lease from a prior round
  // must NOT clear a fresh round's mutex even if both rounds are the
  // same kind. Pre-T1-222 the release was keyed only on kind, so this
  // contract did not hold.
  const svc = makeService(makeController());
  const staleLease = svc.tryAcquireOperation('testFire')!;
  svc.releaseOperation(staleLease);  // round 1 ends
  const freshLease = svc.tryAcquireOperation('testFire')!;
  assert(freshLease.sessionId > staleLease.sessionId,
    `fresh acquire mints a new sessionId (${staleLease.sessionId} → ${freshLease.sessionId})`);
  svc.releaseOperation(staleLease);  // simulate stale .finally firing
  assert(svc.getActiveOperation()?.kind === 'testFire',
    'stale-lease release does NOT clear the fresh round (race protection)');
  assert(svc.getActiveOperation()?.sessionId === freshLease.sessionId,
    'fresh round preserved (sessionId unchanged by stale release)');
  svc.releaseOperation(freshLease);
}

// 8. Mismatched-kind lease release → warns, does NOT release the held kind
{
  const svc = makeService(makeController());
  const jogLease = svc.tryAcquireOperation('jog')!;
  const origWarn = console.warn;
  let warnedMessage: string | null = null;
  console.warn = (msg: string) => { warnedMessage = msg; };
  try {
    // Hand-construct a lease for testFire that happens to share the
    // current sessionId. In production this is unreachable (acquire
    // bakes kind into the lease), but it pins the defensive warn path.
    svc.releaseOperation({ kind: 'testFire', sessionId: jogLease.sessionId });
  } finally {
    console.warn = origWarn;
  }
  assert(warnedMessage !== null && /releaseOperation/.test(warnedMessage),
    'mismatched-kind release emits a warn');
  assert(svc.getActiveOperation()?.kind === 'jog',
    'mismatched-kind release does NOT clear the held kind (jog still active)');
  svc.releaseOperation(jogLease);
}

// 9. Release returns to baseline; new acquire bumps sessionId
{
  const svc = makeService(makeController());
  const first = svc.tryAcquireOperation('jog')!;
  const firstSession = first.sessionId;
  svc.releaseOperation(first);
  const second = svc.tryAcquireOperation('frame')!;
  const secondSession = second.sessionId;
  assert(secondSession > firstSession,
    `sessionId increases across acquire cycles (${firstSession} → ${secondSession})`);
  svc.releaseOperation(second);
}

// 10. T1-222: same-kind re-acquire BUMPS sessionId (race protection)
{
  // Pre-T1-222 same-kind re-acquire preserved sessionId — but that's
  // exactly what made the deadman-vs-endTestFire race exploitable.
  // Post-T1-222 every successful acquire mints a fresh sessionId;
  // the deadman re-entry pattern still works because the OLD timer
  // is clearTimeout'd before the second acquire.
  const svc = makeService(makeController());
  const first = svc.tryAcquireOperation('testFire')!;
  const firstSession = first.sessionId;
  const second = svc.tryAcquireOperation('testFire')!;
  const secondSession = second.sessionId;
  assert(secondSession > firstSession,
    `same-kind re-acquire bumps sessionId for race protection (${firstSession} → ${secondSession})`);
  // The first lease is now stale; releasing with it is a no-op.
  svc.releaseOperation(first);
  assert(svc.getActiveOperation()?.kind === 'testFire',
    'stale first-lease release does not clear the active operation');
  svc.releaseOperation(second);
  assert(svc.getActiveOperation() === null, 'fresh lease release clears the mutex');
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
  const heldLease = svc.tryAcquireOperation('testFire')!;  // simulate test-fire in flight
  const coord = makeCoord(svc, ctrl);
  const r = await coord.jog('X', 5, 1500);
  assert(r.ok === false && r.reason === 'operation-busy',
    'jog refuses with operation-busy when testFire is held');
  assert(svc.getActiveOperation()?.kind === 'testFire',
    'jog refusal does NOT release the holding kind');
  svc.releaseOperation(heldLease);
}

// 12. coord.beginTestFire fails when another op holds the mutex
{
  const ctrl = makeController({ sendCommand: () => {} });
  const svc = makeService(ctrl);
  const heldLease = svc.tryAcquireOperation('frame')!;
  const coord = makeCoord(svc, ctrl);
  const ok = await coord.beginTestFire({ maxSpindle: 1000 });
  assert(ok === false, 'beginTestFire returns false when frame is held');
  assert(svc.getActiveOperation()?.kind === 'frame',
    'frame still held after beginTestFire refusal');
  svc.releaseOperation(heldLease);
}

// 13. coord.beginTestFire releases mutex on rejected testFire operation
{
  const ctrl = makeController({
    sendCommand: () => { throw new Error('blocked'); },
  });
  const svc = makeService(ctrl);
  const coord = makeCoord(svc, ctrl);
  const ok = await coord.beginTestFire({ maxSpindle: 1000 });
  assert(ok === false, 'beginTestFire returns false on rejected testFire operation');
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

// 15. coord.beginTestFire releases mutex when operations.testFire throws
{
  const ctrl = makeController({
    operations: {
      ...makeController().operations,
      testFire: async () => {
        throw new Error('validator throw');
      },
    },
  } as Partial<LaserController>);
  const svc = makeService(ctrl);
  const coord = makeCoord(svc, ctrl);
  let rejected = false;
  const ok = await coord.beginTestFire({ maxSpindle: 1000 }).catch(() => {
    rejected = true;
    return false;
  });
  assert(!rejected, 'beginTestFire does not reject when operations.testFire throws');
  assert(ok === false, 'beginTestFire returns false when operations.testFire throws');
  assert(svc.getActiveOperation() === null,
    'mutex released after thrown beginTestFire start (no leak)');
}

// 16. coord.beginTestFire attempts laser-off if a start throw followed a command
{
  let laserOffCalls = 0;
  const ctrl = makeController({
    operations: {
      ...makeController().operations,
      testFire: async (args: { onCommand?: (line: string) => void }) => {
        args.onCommand?.('M3 S50');
        throw new Error('transport died after M3');
      },
      laserOff: async () => {
        laserOffCalls++;
        return { ok: true };
      },
    },
  } as Partial<LaserController>);
  const svc = makeService(ctrl);
  const coord = makeCoord(svc, ctrl);
  const ok = await coord.beginTestFire({ maxSpindle: 1000 });
  assert(ok === false, 'beginTestFire returns false after post-command throw');
  assert(laserOffCalls === 1,
    `post-command throw attempts emergency laser-off once (got ${laserOffCalls})`);
  assert(svc.getActiveOperation() === null,
    'mutex released after post-command throw');
}

// 15. coord.autoFocus refuses when another op holds the mutex
{
  const ctrl = makeController();
  const svc = makeService(ctrl);
  const heldLease = svc.tryAcquireOperation('frameDot')!;
  const coord = makeCoord(svc, ctrl);
  const r = await coord.autoFocus();
  assert(r.ok === false && 'error' in r && /Another machine operation/.test(r.error),
    'autoFocus refuses with operation-in-progress message when frameDot is held');
  svc.releaseOperation(heldLease);
}

// 16. coord.setOriginAtCurrentPosition refuses while another op holds the mutex
{
  const ctrl = makeController({ sendCommand: () => {} });
  const svc = makeService(ctrl);
  const heldLease = svc.tryAcquireOperation('autoFocus')!;
  const coord = makeCoord(svc, ctrl);
  const r = await coord.setOriginAtCurrentPosition();
  assert(r.ok === false && r.reason === 'operation-busy',
    'setOriginAtCurrentPosition refuses with operation-busy when autoFocus is held');
  svc.releaseOperation(heldLease);
}

// 17. Source-level pin: T2-11 + T1-222 markers in both files
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
  assert(/T1-222/.test(svcSrc), 'T1-222 marker present in MachineService.ts');
  assert(/_activeOperation: ActiveOperationState \| null = null/.test(svcSrc),
    '_activeOperation field declared');
  // T1-222: signatures now use OperationLease instead of returning boolean / taking kind.
  assert(/tryAcquireOperation\(kind: ActiveOperationKind\): OperationLease \| null/.test(svcSrc),
    'tryAcquireOperation public method declared with lease return type');
  assert(/releaseOperation\(lease: OperationLease\): void/.test(svcSrc),
    'releaseOperation public method takes an OperationLease');
  assert(/export interface OperationLease/.test(svcSrc),
    'OperationLease interface exported');
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

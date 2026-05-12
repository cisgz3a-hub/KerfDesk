/**
 * T1-222 (v30 audit #9, lease tokens): the operation mutex's
 * release path must validate a lease's `sessionId` against the
 * currently-held session — a stale-round lease (from a prior
 * round that has already ended) must NOT clear a fresh same-kind
 * session.
 *
 * Pre-T1-222 race scenario:
 *   1. user starts test-fire (sid=10), deadman timer armed
 *   2. deadman fires → callback enters `await emergencyLaserOff()`
 *   3. user immediately starts test-fire again (sid=10 still held
 *      because the deadman's release hasn't run yet → same-kind
 *      reacquire shared sid=10)
 *   4. old deadman's `.finally` runs `releaseOperation('testFire')`
 *   5. mutex cleared even though the user's new round is still active
 *
 * Post-T1-222:
 *   - `tryAcquireOperation` returns an `OperationLease` (or null).
 *   - Every successful acquire mints a FRESH `sessionId` (including
 *     same-kind reacquire).
 *   - `releaseOperation(lease)` validates `lease.sessionId === current.sessionId`;
 *     stale `sessionId` → silent no-op.
 *   - In ExecutionCoordinator the test-fire lease is captured on a
 *     class field shared between `endTestFire` and the deadman
 *     timer closure so both release paths use the lease minted at
 *     the acquire matching that round.
 *
 * Run: npx tsx tests/operation-mutex-lease-tokens.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MutableRefObject } from 'react';
import { MachineService, type OperationLease } from '../src/app/MachineService';
import { ExecutionCoordinator } from '../src/app/ExecutionCoordinator';
import {
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';
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
    state: idle,
    isJobRunning: false,
    maxSpindle: 1000,
    connect: async () => {},
    disconnect: async () => {},
    sendJob: async () => {},
    pause: () => {}, resume: () => {}, stop: () => {}, emergencyStop: () => {},
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
      testFire: async () => ({ ok: true }),
      frame: async () => ({ ok: true }),
      laserOff: async () => ({ ok: true }),
      pauseJob: async () => ({ ok: true }),
      resumeJob: async () => ({ ok: true }),
      stopJob: async () => ({ ok: true }),
      emergencyStop: async () => ({ ok: true }),
    },
  } as unknown as LaserController;
}

function buildService(ctrl: LaserController): MachineService {
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: {} as SerialPortLike } as MutableRefObject<SerialPortLike | null>;
  return new MachineService(ref, portRef);
}

console.log('\n=== T1-222 operation-mutex lease tokens ===\n');

void (async () => {

// -------- 1. Lease shape: acquire returns OperationLease, not boolean --------
{
  const svc = buildService(makeController());
  const lease = svc.tryAcquireOperation('jog');
  assert(lease !== null, 'acquire returns a lease (not null) when mutex is free');
  assert(lease?.kind === 'jog', `lease.kind === 'jog' (got ${lease?.kind})`);
  assert(typeof lease?.sessionId === 'number',
    `lease.sessionId is a number (got ${typeof lease?.sessionId})`);
  assert((lease?.sessionId ?? 0) > 0, 'lease.sessionId > 0');
  if (lease) svc.releaseOperation(lease);
}

// -------- 2. Contention: acquire returns null --------
{
  const svc = buildService(makeController());
  const first = svc.tryAcquireOperation('testFire');
  const second = svc.tryAcquireOperation('jog');
  assert(second === null, 'different-kind acquire returns null while testFire is held');
  if (first) svc.releaseOperation(first);
}

// -------- 3. Same-kind reacquire mints a FRESH sessionId (race protection) --------
{
  const svc = buildService(makeController());
  const first = svc.tryAcquireOperation('testFire')!;
  const second = svc.tryAcquireOperation('testFire')!;
  assert(first.sessionId !== second.sessionId,
    `same-kind reacquire mints a fresh sessionId (${first.sessionId} → ${second.sessionId})`);
  assert(second.sessionId > first.sessionId,
    'fresh sessionId is monotonically greater than the prior session');
  svc.releaseOperation(second);
}

// -------- 4. Stale-lease release is a silent no-op (the audit race) --------
{
  // Pre-T1-222 the release was keyed only on kind. A stale-round
  // release would clear the fresh round's mutex. Post-T1-222 the
  // sessionId mismatch makes the stale release a silent no-op.
  const svc = buildService(makeController());
  const round1 = svc.tryAcquireOperation('testFire')!;
  svc.releaseOperation(round1);  // round 1 ends
  const round2 = svc.tryAcquireOperation('testFire')!;
  assert(round2.sessionId > round1.sessionId,
    'round 2 has a different sessionId');

  // Now simulate the stale-round race: release with the round1 lease.
  // This is the deadman .finally firing AFTER endTestFire AND AFTER a
  // fresh beginTestFire kicked off round 2.
  svc.releaseOperation(round1);

  const active = svc.getActiveOperation();
  assert(active !== null,
    'fresh round survives the stale-round release (mutex still held)');
  assert(active?.kind === 'testFire',
    'fresh round kind preserved');
  assert(active?.sessionId === round2.sessionId,
    `fresh round sessionId preserved (round2.sessionId=${round2.sessionId}, current=${active?.sessionId})`);

  svc.releaseOperation(round2);
  assert(svc.getActiveOperation() === null,
    'fresh-round lease release does clear the mutex');
}

// -------- 5. Stale-lease release does not warn (it's an expected race) --------
{
  const svc = buildService(makeController());
  const stale = svc.tryAcquireOperation('testFire')!;
  svc.releaseOperation(stale);
  const fresh = svc.tryAcquireOperation('testFire')!;

  const origWarn = console.warn;
  let warned: string | null = null;
  console.warn = (msg: string) => { warned = msg; };
  try {
    svc.releaseOperation(stale);  // stale-session release
  } finally {
    console.warn = origWarn;
  }
  assert(warned === null,
    'stale-lease release is silent (no warn — it is the expected race path)');
  svc.releaseOperation(fresh);
}

// -------- 6. Mismatched-kind lease release warns + does not clear --------
{
  const svc = buildService(makeController());
  const jogLease = svc.tryAcquireOperation('jog')!;
  // Construct an out-of-band lease whose kind disagrees with the
  // currently held operation. Production code can't reach this
  // because acquire bakes the kind into the lease, but a
  // hand-constructed lease pins the defensive warn path.
  const liar: OperationLease = { kind: 'testFire', sessionId: jogLease.sessionId };

  const origWarn = console.warn;
  let warned: string | null = null;
  console.warn = (msg: string) => { warned = msg; };
  try {
    svc.releaseOperation(liar);
  } finally {
    console.warn = origWarn;
  }
  assert(warned !== null && /T1-222/.test(warned ?? ''),
    'kind-mismatch release emits a T1-222 warn');
  assert(svc.getActiveOperation()?.kind === 'jog',
    'kind-mismatch release does NOT clear the held operation');
  svc.releaseOperation(jogLease);
}

// -------- 7. Lease release without anything held is a silent no-op --------
{
  const svc = buildService(makeController());
  const liar: OperationLease = { kind: 'jog', sessionId: 42 };
  let threw = false;
  try { svc.releaseOperation(liar); } catch { threw = true; }
  assert(!threw, 'release with nothing held does not throw');
  assert(svc.getActiveOperation() === null,
    'release with nothing held leaves the operation null');
}

// -------- 8. ExecutionCoordinator: deadman + endTestFire race is safe --------
{
  // This is the integration form of the audit race. Drive the
  // coordinator into a state where the deadman's release fires AFTER
  // a fresh beginTestFire has already started a new round. Pre-T1-222
  // this cleared the new round's mutex; post-T1-222 the stale
  // release is silent.
  const ctrl = makeController();
  const svc = buildService(ctrl);
  const coord = new ExecutionCoordinator({
    machineService: svc,
    controllerRef: { current: ctrl } as MutableRefObject<LaserController | null>,
    notifySimulatorRef: { current: () => {} },
    testFireDeadmanMs: 10,  // expire fast
  });

  // Round 1: begin + let deadman fire.
  const r1 = await coord.beginTestFire({ maxSpindle: 1000 });
  assert(r1 === true, 'round 1: beginTestFire returned true');
  // Wait long enough for the deadman to fire AND for emergencyLaserOff
  // to run to completion (it awaits its safetyOff). Mock safetyOff
  // resolves synchronously so a few microtask flushes are enough.
  await new Promise(r => setTimeout(r, 30));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert(svc.getActiveOperation() === null,
    'round 1: after deadman fires the mutex is released');

  // Round 2: start a fresh testFire. Use the same coordinator (the
  // _testFireLease field will be repopulated).
  const r2 = await coord.beginTestFire({ maxSpindle: 1000 });
  assert(r2 === true, 'round 2: beginTestFire returned true');
  assert(svc.getActiveOperation()?.kind === 'testFire',
    'round 2: mutex held for new testFire');

  // End round 2.
  await coord.endTestFire();
  // Wait for any deadman path to settle (round 2's timer should
  // have been clearTimeout'd by endTestFire, so this is paranoia).
  await new Promise(r => setTimeout(r, 30));
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert(svc.getActiveOperation() === null,
    'round 2: endTestFire releases the mutex cleanly');
}

// -------- 9. Source pins --------
{
  const svcSrc = readFileSync(
    resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(/T1-222/.test(svcSrc), 'MachineService.ts carries T1-222 marker');
  assert(/export interface OperationLease/.test(svcSrc),
    'OperationLease interface exported from MachineService.ts');
  assert(
    /readonly kind: ActiveOperationKind;\s*readonly sessionId: number;/.test(svcSrc),
    'OperationLease shape is { readonly kind; readonly sessionId }',
  );
  assert(
    /tryAcquireOperation\(kind: ActiveOperationKind\): OperationLease \| null/.test(svcSrc),
    'tryAcquireOperation signature returns OperationLease | null',
  );
  assert(
    /releaseOperation\(lease: OperationLease\): void/.test(svcSrc),
    'releaseOperation signature takes OperationLease',
  );
  // The stale-session guard must compare sessionIds before kinds.
  assert(
    /this\._activeOperation\.sessionId !== lease\.sessionId/.test(svcSrc),
    'releaseOperation compares sessionIds (stale-session guard)',
  );

  // ExecutionCoordinator pins.
  const coordSrc = readFileSync(
    resolve(here, '../src/app/ExecutionCoordinator.ts'),
    'utf-8',
  );
  assert(/T1-222/.test(coordSrc), 'ExecutionCoordinator.ts carries T1-222 marker');
  assert(
    /_testFireLease: OperationLease \| null = null/.test(coordSrc),
    '_testFireLease field declared for cross-path lease sharing',
  );
  // The lease is captured at acquire and reused across all release sites
  // (failed-start, endTestFire, deadman .finally).
  assert(
    /const lease = this\.deps\.machineService\.tryAcquireOperation\('testFire'\)/.test(coordSrc),
    'beginTestFire captures the lease from tryAcquireOperation',
  );
  assert(
    /this\.deps\.machineService\.releaseOperation\(lease\)/.test(coordSrc),
    'release call sites thread the captured lease through release',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

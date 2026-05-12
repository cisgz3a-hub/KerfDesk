/**
 * T1-221 (v30 audit #9, bypass plug): `MachineService.jog()` must
 * acquire the operation mutex for the duration of the jog,
 * matching the behaviour of `ExecutionCoordinator.jog()`.
 *
 * Pre-T1-221 `MachineService.jog()` went directly to
 * `ctrl.operations.jog(...)` with no `tryAcquireOperation` pair.
 * `ExecutionCoordinator.jog()` correctly acquired the mutex, but a
 * future UI path / test harness calling `MachineService.jog()`
 * directly could interleave with an active test-fire / frame-dot
 * / autoFocus — all of which issue motion + modal commands that
 * would race on GRBL's command queue.
 *
 * Post-T1-221 `MachineService.jog()` acquires the mutex via
 * `tryAcquireOperation('jog')` and releases it in a `finally` so
 * a thrown jog still cleans up.
 *
 * Run: npx tsx tests/machine-service-jog-respects-mutex.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type MutableRefObject } from 'react';
import { MachineService } from '../src/app/MachineService';
import { type SerialPortLike } from '../src/communication/SerialPort';
import {
  type LaserController,
  type MachineState,
} from '../src/controllers/ControllerInterface';

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

function makeController(opts: {
  jogResolveValue?: { ok: true } | { ok: false; reason: string };
  jogThrows?: boolean;
  jogStartedCounter?: { count: number };
} = {}): LaserController {
  const jogResolveValue = opts.jogResolveValue ?? { ok: true };
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
      jog: async () => {
        if (opts.jogStartedCounter) opts.jogStartedCounter.count++;
        if (opts.jogThrows) throw new Error('simulated transport failure');
        return jogResolveValue;
      },
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
  const ref = { current: ctrl } as MutableRefObject<LaserController>;
  const portRef = { current: {} as SerialPortLike } as MutableRefObject<SerialPortLike | null>;
  return new MachineService(ref, portRef);
}

console.log('\n=== T1-221 MachineService.jog respects operation mutex ===\n');

void (async () => {

// -------- 1. Happy path: jog acquires + releases the mutex --------
{
  const svc = buildService(makeController());
  assert(svc.getActiveOperation() === null, 'precondition: no active operation');

  const result = await svc.jog('X', 5, 1500);
  assert(result.ok === true, 'jog succeeds');
  assert(svc.getActiveOperation() === null, 'mutex released after successful jog');
}

// -------- 2. Mutex contention: jog refused while another op is active --------
{
  const ctrl = makeController();
  const svc = buildService(ctrl);

  // Acquire a different operation kind (testFire) to simulate
  // contention. tryAcquireOperation is public.
  // T1-222: tryAcquireOperation returns an OperationLease (or null).
  const testFireLease = svc.tryAcquireOperation('testFire');
  assert(testFireLease !== null, 'precondition: testFire mutex acquired');

  const counter = { count: 0 };
  // Replace the ctrl's jog with a counting variant.
  (ctrl as unknown as { operations: { jog: () => Promise<{ ok: true }> } }).operations.jog =
    async () => { counter.count++; return { ok: true }; };

  const result = await svc.jog('X', 5, 1500);
  assert(result.ok === false, 'jog refused while testFire is active');
  assert(result.reason === 'operation-busy', "reason is 'operation-busy'");
  assert(counter.count === 0,
    'controller.operations.jog was NOT called (mutex prevented bypass)');

  if (testFireLease) svc.releaseOperation(testFireLease);
  assert(svc.getActiveOperation() === null, 'mutex released for cleanup');
}

// -------- 3. Mutex released even when operations.jog throws --------
{
  const ctrl = makeController({ jogThrows: true });
  const svc = buildService(ctrl);

  const result = await svc.jog('Y', 10, 2000);
  assert(result.ok === false, 'thrown jog returns ok:false');
  assert(/simulated transport failure/.test(result.reason ?? ''), 'reason carries the error message');
  assert(
    svc.getActiveOperation() === null,
    'mutex released by finally even when operations.jog throws',
  );
}

// -------- 4. Source pins --------
{
  const src = readFileSync(
    resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(/T1-221/.test(src), 'MachineService.ts carries T1-221 marker');

  // Slice the jog method body.
  const jogStart = src.indexOf('async jog(axis:');
  const jogEnd = src.indexOf('\n  }', jogStart);
  const jogBody = src.slice(jogStart, jogEnd > jogStart ? jogEnd : jogStart + 2500);

  assert(
    /this\.tryAcquireOperation\('jog'\)/.test(jogBody),
    'jog() acquires the mutex via tryAcquireOperation(\'jog\')',
  );
  // T1-222: release now threads the OperationLease (not the kind string).
  assert(
    /this\.releaseOperation\(lease\)/.test(jogBody),
    'jog() releases the mutex via releaseOperation(lease) (T1-222 lease-token API)',
  );
  assert(
    /finally\s*\{[\s\S]{0,200}this\.releaseOperation\(lease\)/.test(jogBody),
    'release is inside a finally block (handles throws)',
  );
  // Refusal returns 'operation-busy' (matches ExecutionCoordinator).
  assert(
    /reason: 'operation-busy'/.test(jogBody),
    "refusal reason matches ExecutionCoordinator.jog ('operation-busy')",
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

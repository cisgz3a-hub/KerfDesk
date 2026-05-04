/**
 * T2-56: MachineService.attachAutoFinalize subscribes to controller
 * state + progress events directly, so job-log finalization runs
 * whether or not the connection panel is mounted.
 *
 * Pre-T2-56 finalization was driven by a `useEffect` inside
 * `ConnectionPanel.tsx`. If the panel was unmounted (sidebar closed,
 * route change) at the moment of the run→idle transition, the effect
 * didn't fire — finalization was delayed until the panel remounted, or
 * missed entirely.
 *
 * Run: npx tsx tests/auto-finalize-without-mounted-ui.test.ts
 */
import type { MutableRefObject } from 'react';
import { MachineService } from '../src/app/MachineService';
import {
  type LaserController,
  type MachineState,
  type JobProgress,
} from '../src/controllers/ControllerInterface';
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

console.log('\n=== T2-56 auto-finalize without mounted UI ===\n');

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length(): number { return Object.keys(memoryStore).length; },
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  getItem: (k: string) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
  removeItem: (k: string) => { delete memoryStore[k]; },
  clear: () => { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
};

const idle: MachineState = {
  status: 'idle', position: { x: 0, y: 0, z: 0 },
  feedRate: 0, spindleSpeed: 0, alarmCode: null, errorCode: null,
};

async function run(): Promise<void> {

interface MockCtrl extends LaserController {
  fireStateChange(state: MachineState): void;
  fireProgress(progress: JobProgress): void;
  setIsJobRunning(v: boolean): void;
}

function makeMockController(): MockCtrl {
  const stateListeners: ((s: MachineState) => void)[] = [];
  const progressListeners: ((p: JobProgress) => void)[] = [];
  // Mutable closure-state lets `this`-style fire methods avoid TS
  // self-typing pain. The MockCtrl cast is safe because we exhaustively
  // cover the surface that attachAutoFinalize touches.
  const innerState: { state: MachineState; isJobRunning: boolean } = {
    state: idle,
    isJobRunning: false,
  };
  const ctrl = {
    get state() { return innerState.state; },
    get isJobRunning() { return innerState.isJobRunning; },
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
    onStateChange: (cb: (s: MachineState) => void) => {
      stateListeners.push(cb);
      return () => {
        const i = stateListeners.indexOf(cb);
        if (i >= 0) stateListeners.splice(i, 1);
      };
    },
    onProgress: (cb: (p: JobProgress) => void) => {
      progressListeners.push(cb);
      return () => {
        const i = progressListeners.indexOf(cb);
        if (i >= 0) progressListeners.splice(i, 1);
      };
    },
    onError: () => () => {},
    onRawLine: () => () => {},
    safetyOff: async () => ({ stage: 'm5' as const }),
    fireStateChange(state: MachineState): void {
      innerState.state = state;
      for (const cb of stateListeners) cb(state);
    },
    fireProgress(progress: JobProgress): void {
      for (const cb of progressListeners) cb(progress);
    },
    setIsJobRunning(v: boolean): void {
      innerState.isJobRunning = v;
    },
  } as unknown as MockCtrl;
  return ctrl;
}

function makeService(ctrl: MockCtrl): MachineService {
  const portRef = { current: null } as { current: SerialPortLike | null };
  const ctrlRef = { current: ctrl } as { current: LaserController };
  return new MachineService(
    ctrlRef as MutableRefObject<LaserController>,
    portRef as MutableRefObject<SerialPortLike | null>,
  );
}

// 1. attachAutoFinalize returns an unsubscribe function
{
  const ctrl = makeMockController();
  const svc = makeService(ctrl);
  const unsub = svc.attachAutoFinalize(ctrl);
  assert(typeof unsub === 'function', 'attachAutoFinalize returns an unsub function');
  unsub();
}

// 2. State change events drive tryFinalizeJobLog without mounted UI
{
  const ctrl = makeMockController();
  const svc = makeService(ctrl);
  const unsub = svc.attachAutoFinalize(ctrl);

  // Simulate a controller state-change event. Without a current job,
  // tryFinalizeJobLog short-circuits — but the listener fires.
  let listenerCallCount = 0;
  const tracked = svc.tryFinalizeJobLog;
  svc.tryFinalizeJobLog = (async (...args: unknown[]) => {
    listenerCallCount++;
    return tracked.apply(svc, args as Parameters<typeof tracked>);
  }) as typeof svc.tryFinalizeJobLog;

  ctrl.fireStateChange({ ...idle, status: 'idle' });
  assert(listenerCallCount >= 1,
    `state-change event triggers tryFinalizeJobLog (got ${listenerCallCount} calls)`);

  unsub();
}

// 3. Progress events drive tryFinalizeJobLog
{
  const ctrl = makeMockController();
  const svc = makeService(ctrl);
  const unsub = svc.attachAutoFinalize(ctrl);

  let listenerCallCount = 0;
  const tracked = svc.tryFinalizeJobLog;
  svc.tryFinalizeJobLog = (async (...args: unknown[]) => {
    listenerCallCount++;
    return tracked.apply(svc, args as Parameters<typeof tracked>);
  }) as typeof svc.tryFinalizeJobLog;

  ctrl.fireProgress({
    linesSent: 1, linesAcknowledged: 1, totalLines: 1, percentComplete: 100,
    elapsedMs: 100, bufferFill: 0, healthStatus: 'healthy',
    ackRateHz: null, expectedAckRateHz: null,
  });
  assert(listenerCallCount >= 1,
    'progress event triggers tryFinalizeJobLog');

  unsub();
}

// 4. Unsubscribe stops the listeners — no further calls
{
  const ctrl = makeMockController();
  const svc = makeService(ctrl);
  const unsub = svc.attachAutoFinalize(ctrl);

  let listenerCallCount = 0;
  const tracked = svc.tryFinalizeJobLog;
  svc.tryFinalizeJobLog = (async (...args: unknown[]) => {
    listenerCallCount++;
    return tracked.apply(svc, args as Parameters<typeof tracked>);
  }) as typeof svc.tryFinalizeJobLog;

  unsub();

  ctrl.fireStateChange({ ...idle });
  ctrl.fireProgress({
    linesSent: 1, linesAcknowledged: 1, totalLines: 1, percentComplete: 100,
    elapsedMs: 100, bufferFill: 0, healthStatus: 'healthy',
    ackRateHz: null, expectedAckRateHz: null,
  });
  assert(listenerCallCount === 0,
    `post-unsub events trigger zero listener calls (got ${listenerCallCount})`);
}

// 5. Source-level pin: T2-56 marker + integration shape
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));

  const svcSrc = fs.readFileSync(
    path.resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(/T2-56/.test(svcSrc), 'T2-56 marker in MachineService.ts');
  assert(/attachAutoFinalize\(ctrl: LaserController\): \(\) => void/.test(svcSrc),
    'attachAutoFinalize signature declared');
  assert(/ctrl\.onStateChange\(/.test(svcSrc),
    'attachAutoFinalize subscribes to onStateChange');
  assert(/ctrl\.onProgress\(/.test(svcSrc),
    'attachAutoFinalize subscribes to onProgress');

  const hookSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/hooks/useMachineService.ts'),
    'utf-8',
  );
  assert(/T2-56/.test(hookSrc), 'T2-56 marker in useMachineService.ts');
  assert(/controllerReady: boolean/.test(hookSrc),
    'useMachineService takes controllerReady arg');
  assert(/service\.attachAutoFinalize\(ctrl\)/.test(hookSrc),
    'useMachineService calls service.attachAutoFinalize once controller is ready');

  const appSrc = fs.readFileSync(
    path.resolve(here, '../src/ui/components/App.tsx'),
    'utf-8',
  );
  assert(/controllerReady: grbl\.controllerReady/.test(appSrc),
    'App.tsx threads grbl.controllerReady to useMachineService');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

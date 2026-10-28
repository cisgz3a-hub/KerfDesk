// @vitest-environment node
// Rolling audit v6 K1 (ADR-676), by the refuter's method: the controller model
// runs on its own node:worker_threads thread with the real clock; the real
// store runs on this thread, which a synchronous busy loop blocks mid-burn,
// as a large edit, Undo or import blocks the app window.
//
// On the window transport nothing refills the controller during the block, so
// it drains and stops the head with the beam lit: the Marlin fan output, the
// Marlin inline cutter (until its 1 s safety timeout) and GRBL under M3. Those
// runs are the controls, and Job Review's warning must name each of them.
// With the fix, a worker refills Marlin USB and network GRBL-family sessions,
// and the head never stops lit while this thread is blocked.

import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { build } from 'vite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import {
  DEFAULT_DEVICE_PROFILE,
  type ControllerKind,
  type DeviceProfile,
} from '../../core/devices';
import type { Job } from '../../core/job';
import { grblStrategy } from '../../core/output/grbl-strategy';
import { marlinStrategy } from '../../core/output/marlin-strategy';
import { createDesktopMachineNetwork } from '../../platform/electron/desktop-machine-network';
import type { PlatformAdapter, SerialConnection, SerialOpenRequest } from '../../platform/types';
import { createNetworkSessionOpener } from '../../platform/web/network-serial-connection';
import type { SerialWorkerResponse } from '../../platform/web/serial-worker-protocol';
import { createWorkerSerialConnection } from '../../platform/web/worker-serial-connection';
import type {
  LitStop,
  StallThreadConfig,
  StallThreadMessage,
} from '../../__fixtures__/controllers/stall-thread-entry';
import { liveWindowStreamLitStopWarnings } from '../laser/job-review/window-stream-lit-stop-warnings';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

let threadCode = '';
const threads: Worker[] = [];

beforeAll(async () => {
  const result = await build({
    configFile: false,
    root: resolve('.'),
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: {
        entry: resolve('src/__fixtures__/controllers/stall-thread-entry.ts'),
        name: 'stallThread',
        formats: ['iife'],
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !('output' in output)) throw new Error('Missing build output');
  const chunk = output.output.find((item) => item.type === 'chunk');
  if (chunk?.type !== 'chunk') throw new Error('Missing JS chunk');
  threadCode = chunk.code;
}, 60_000);

afterEach(async () => {
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  for (const thread of threads.splice(0)) await thread.terminate();
  useLaserStore.setState(initialLaserState());
  resetStore();
  vi.restoreAllMocks();
});

function spawn(config: StallThreadConfig): Worker {
  const thread = new Worker(
    `${threadCode}\nconst wt = require('node:worker_threads');\nstallThread.start(wt.parentPort, wt.workerData);`,
    { eval: true, workerData: config },
  );
  threads.push(thread);
  return thread;
}

function on(thread: Worker, channel: StallThreadMessage['channel'], handler: (m: never) => void) {
  thread.on('message', (message: StallThreadMessage) => {
    if (message.channel === channel) handler(message as never);
  });
}

// Every refill waits for this thread's own `ok` handler (ping-pong for Marlin,
// character counting for GRBL): the transport the audit found.
function windowConnection(thread: Worker): SerialConnection {
  const lines = new Set<(line: string) => void>();
  on(thread, 'wire', (message: { readonly line: string }) => {
    for (const handler of lines) handler(message.line);
  });
  return {
    write: async (data) => thread.postMessage({ channel: 'wire', data }),
    onLine: (handler) => {
      lines.add(handler);
      return () => lines.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
  };
}

// The production worker transport, with the port the thread owns.
function usbWorkerConnection(thread: Worker): SerialConnection {
  const handlers = new Set<(message: SerialWorkerResponse) => void>();
  on(thread, 'serial', (message: { readonly message: SerialWorkerResponse }) => {
    for (const handler of handlers) handler(message.message);
  });
  return createWorkerSerialConnection({
    bridge: {
      postMessage: (message, transfer) =>
        thread.postMessage({ channel: 'serial', message }, (transfer ?? []) as ArrayBuffer[]),
      onMessage: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      terminate: () => undefined,
    },
    port: { readable: null, writable: null, close: async () => undefined },
    start: () => thread.postMessage({ channel: 'serial', message: { kind: 'harness-start' } }),
  });
}

// The USB port: the worker only when the store asks for it, as web-serial.ts does.
function usbAdapter(thread: Worker, transport: StallThreadConfig['transport']): PlatformAdapter {
  return {
    id: 'electron',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({
        open: async (request: SerialOpenRequest) =>
          transport === 'usb-worker' && request.hostedStreaming === true
            ? usbWorkerConnection(thread)
            : windowConnection(thread),
      }),
    },
  };
}

// The production desktop network adapter and session opener; the thread runs
// the network worker runtime against faked main-process routes.
function networkAdapter(thread: Worker): PlatformAdapter {
  const worker = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null,
    onmessageerror: null,
    postMessage: (message: unknown, transfer?: ArrayBuffer[]) =>
      thread.postMessage({ channel: 'serial', message }, transfer ?? []),
    terminate: () => undefined,
  };
  on(thread, 'serial', (message: { readonly message: unknown }) => {
    worker.onmessage?.({ data: message.message } as MessageEvent);
  });
  const network = createDesktopMachineNetwork(
    async (action) =>
      action === 'open' ? { sessionId: '00000000-0000-4000-8000-000000000001' } : {},
    createNetworkSessionOpener(() => worker as unknown as globalThis.Worker),
  );
  return {
    id: 'electron',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: network.serialForTarget('192.0.2.5', 23, 'grblhal-raw'),
  };
}

async function report(thread: Worker): Promise<{
  readonly litStops: ReadonlyArray<LitStop>;
  readonly received: ReadonlyArray<string>;
  readonly armAcks: ReadonlyArray<string | null>;
}> {
  return new Promise((done) => {
    const handler = (message: StallThreadMessage): void => {
      if (message.channel !== 'harness') return;
      thread.off('message', handler);
      done(message);
    };
    thread.on('message', handler);
    thread.postMessage({ channel: 'harness', kind: 'report' });
  });
}

async function until(condition: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((settle) => setTimeout(settle, 5));
  }
}

/** The synchronous stall: nothing else on this thread runs until it ends. */
function blockThisThread(ms: number): { readonly from: number; readonly to: number } {
  const from = Date.now();
  while (Date.now() - from < ms) {
    // busy
  }
  return { from, to: Date.now() };
}

function litMsDuring(stops: ReadonlyArray<LitStop>, window: { from: number; to: number }): number {
  return stops.reduce(
    (total, stop) =>
      total + Math.max(0, Math.min(stop.to, window.to) - Math.max(stop.from, window.from)),
    0,
  );
}

// A fine zigzag engrave: 0.28 mm moves at 1,500 mm/min, about 11 ms each, so
// the 16-block Marlin planner holds under 0.2 s (the audit's engrave case).
function engraveJob(segments: number): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#ff0000',
        power: 80,
        speed: 1500,
        passes: 1,
        airAssist: false,
        segments: [
          {
            polyline: Array.from({ length: segments + 1 }, (_, i) => ({
              x: 10 + i * 0.2,
              y: 50 + (i % 2) * 0.2,
            })),
            closed: false,
          },
        ],
      },
    ],
  };
}

type Case = {
  readonly firmware: StallThreadConfig['firmware'];
  readonly controllerKind: ControllerKind;
  readonly device: Partial<DeviceProfile>;
  readonly program: (device: DeviceProfile) => string;
  readonly streamingMode?: 'ping-pong';
  readonly stallMs: number;
};

const MARLIN_INLINE: Case = {
  firmware: 'marlin',
  controllerKind: 'marlin',
  device: {
    controllerKind: 'marlin',
    maxPowerS: 255,
    gcodeDialect: { dialectId: 'marlin-inline' },
  },
  program: (device) => marlinStrategy.emit(engraveJob(360), device),
  streamingMode: 'ping-pong',
  stallMs: 1_600,
};
const MARLIN_FAN: Case = {
  ...MARLIN_INLINE,
  device: { controllerKind: 'marlin', maxPowerS: 255, gcodeDialect: { dialectId: 'marlin-fan' } },
};
const GRBL_COMPATIBLE: Case = {
  firmware: 'grbl',
  controllerKind: 'grbl-v1.1',
  device: { controllerKind: 'grbl-v1.1', gcodeDialect: { dialectId: 'grbl-compatible' } },
  program: (device) => grblStrategy.emit(engraveJob(420), device),
  stallMs: 1_000,
};
const GRBLHAL_COMPATIBLE: Case = {
  ...GRBL_COMPATIBLE,
  firmware: 'grblhal',
  controllerKind: 'grblhal',
  device: { controllerKind: 'grblhal', gcodeDialect: { dialectId: 'grbl-compatible' } },
};

type Run = {
  readonly litDuringStall: number;
  readonly stall: { readonly from: number; readonly to: number };
  readonly received: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly program: string;
  readonly armAcks: ReadonlyArray<string | null>;
};

async function runStall(
  testCase: Case,
  transport: StallThreadConfig['transport'],
  options: { readonly hostedStreaming?: boolean; readonly abortAfterStall?: boolean } = {},
): Promise<Run> {
  const thread = spawn({ firmware: testCase.firmware, transport });
  useStore.getState().updateDeviceProfile(testCase.device);
  const device = { ...DEFAULT_DEVICE_PROFILE, ...testCase.device };
  const program = testCase.program(device);
  const adapter =
    transport === 'network-worker' ? networkAdapter(thread) : usbAdapter(thread, transport);
  await useLaserStore.getState().connect(adapter, {
    controllerKind: testCase.controllerKind,
    ...(transport === 'network-worker' ? { portSelection: 'choose' } : { baudRate: 250_000 }),
    ...(options.hostedStreaming === undefined ? {} : { hostedStreaming: options.hostedStreaming }),
  });
  thread.postMessage({ channel: 'harness', kind: 'boot' });
  await until(() => {
    const state = useLaserStore.getState();
    return state.statusReport?.state === 'Idle' && state.controllerOperation === null;
  }, 8_000);
  // Job Review's warning, from the live session, for the exact program.
  const warnings = liveWindowStreamLitStopWarnings(useLaserStore.getState(), program);
  await startTestLaserJob(
    program,
    testCase.streamingMode === undefined ? {} : { streamingMode: testCase.streamingMode },
  );
  await new Promise((settle) => setTimeout(settle, 700));
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  const stall = blockThisThread(testCase.stallMs);
  if (options.abortAfterStall === true) await useLaserStore.getState().stopJob();
  else await until(() => useLaserStore.getState().streamer?.status === 'done', 15_000);
  await new Promise((settle) => setTimeout(settle, 200));
  const measured = await report(thread);
  return {
    litDuringStall: litMsDuring(measured.litStops, { from: stall.from, to: stall.to + 50 }),
    stall,
    received: measured.received.join('').split('\n'),
    warnings,
    program,
    armAcks: measured.armAcks,
  };
}

/** True when `lines` appears in `received` as one unbroken run. */
function containsRun(received: ReadonlyArray<string>, lines: ReadonlyArray<string>): boolean {
  const start = received.indexOf(lines[0] ?? '');
  return start >= 0 && lines.every((line, index) => received[start + index] === line);
}

const LIT_TOLERANCE_MS = 25;

describe('a blocked window during a burn (rolling audit v6 K1)', () => {
  describe('controls: the window transport stops the head with the beam lit', () => {
    it('Marlin fan output stays on for the rest of the stall, and Job Review says E-stop', async () => {
      const run = await runStall(MARLIN_FAN, 'window', { hostedStreaming: false });
      expect(run.litDuringStall).toBeGreaterThan(MARLIN_FAN.stallMs - 400);
      expect(run.warnings).toEqual([expect.stringContaining('until you press the E-stop')]);
    }, 40_000);

    it('Marlin inline stays lit until the 1 s safety timeout, and Job Review names it', async () => {
      const run = await runStall(MARLIN_INLINE, 'window', { hostedStreaming: false });
      expect(run.litDuringStall).toBeGreaterThan(800);
      // Sampled each millisecond on a shared clock, so allow some jitter.
      expect(run.litDuringStall).toBeLessThan(1_100);
      expect(run.warnings).toEqual([expect.stringContaining('LASER_SAFETY_TIMEOUT_MS')]);
    }, 40_000);

    it('GRBL under M3 stays lit for the rest of the stall, and Job Review names it', async () => {
      const run = await runStall(GRBL_COMPATIBLE, 'window', { hostedStreaming: false });
      expect(run.litDuringStall).toBeGreaterThan(GRBL_COMPATIBLE.stallMs - 400);
      expect(run.warnings).toEqual([expect.stringContaining('constant power (M3')]);
    }, 40_000);
  });

  describe('fixed: a worker refills the controller while the window is blocked', () => {
    it('Marlin inline over a worker-owned USB port never stops lit', async () => {
      const run = await runStall(MARLIN_INLINE, 'usb-worker');
      expect(useLaserStore.getState().jobStreamHost).toBe('worker');
      // The store armed the worker with Marlin's reply grammar.
      expect(run.armAcks).toEqual(['marlin']);
      expect(run.litDuringStall).toBeLessThan(LIT_TOLERANCE_MS);
      expect(run.warnings).toEqual([]);
      // Every line reached the controller once, in order.
      const queued = createStreamer(run.program).queued.map((line) => line.trimEnd());
      expect(containsRun(run.received, queued)).toBe(true);
    }, 40_000);

    it('Marlin fan output over a worker-owned USB port never stops lit, and Abort stops clean', async () => {
      const run = await runStall(MARLIN_FAN, 'usb-worker', { abortAfterStall: true });
      expect(run.armAcks).toEqual(['marlin']);
      expect(run.litDuringStall).toBeLessThan(LIT_TOLERANCE_MS);
      expect(run.warnings).toEqual([]);
      // Abort's quickstop (M107, M410, M5 I) takes the refill back first, so
      // no job move follows it on the wire.
      const quickstop = run.received.indexOf('M410');
      expect(run.received[quickstop - 1]).toBe('M107');
      expect(run.received.slice(quickstop).filter((line) => /^G[0-3]\b/.test(line))).toEqual([]);
      await until(() => useLaserStore.getState().pendingUntrackedAcks === 0, 5_000);
    }, 40_000);

    it('grblHAL under M3 over a desktop network session never stops lit', async () => {
      const run = await runStall(GRBLHAL_COMPATIBLE, 'network-worker');
      expect(run.armAcks).toEqual(['grbl']);
      expect(useLaserStore.getState().jobStreamHost).toBe('worker');
      expect(run.litDuringStall).toBeLessThan(LIT_TOLERANCE_MS);
      expect(run.warnings).toEqual([]);
    }, 40_000);
  });
});

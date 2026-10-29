// The main-thread half of the in-window stall test (rolling audit v6 K1 and
// v8 N1, ADR-676), by the refuter's method: the controller model runs on its
// own node:worker_threads thread with the real clock
// (`stall-thread-entry.ts`); the real store runs on
// the test's thread, which a synchronous busy loop blocks mid-burn, as a large
// edit, Undo or import blocks the app window.

import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { build } from 'vite';
import { expect } from 'vitest';
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
import type {
  SerialWorkerRequest,
  SerialWorkerResponse,
} from '../../platform/web/serial-worker-protocol';
import { createWorkerSerialConnection } from '../../platform/web/worker-serial-connection';
import type { Arrival, LitStop, StallThreadConfig, StallThreadMessage } from './stall-thread-entry';
import { liveWindowStreamLitStopWarnings } from '../../ui/laser/job-review/window-stream-lit-stop-warnings';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
import { useStore } from '../../ui/state/store';

let threadCode = '';
const threads: Worker[] = [];

/** Bundles the controller thread once per test file. */
export async function buildStallThread(): Promise<void> {
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
}

export async function terminateStallThreads(): Promise<void> {
  for (const thread of threads.splice(0)) await thread.terminate();
}

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

type WorkerOptions = {
  /** Main-thread time each forwarded line costs, as a renderer's would. */
  readonly lineCostMs?: number;
  /** Receives every line this thread asks the worker to write. */
  readonly windowWrites?: string[];
};

// The production worker transport, with the port the thread owns.
function usbWorkerConnection(thread: Worker, options: WorkerOptions): SerialConnection {
  const handlers = new Set<(message: SerialWorkerResponse) => void>();
  on(thread, 'serial', (message: { readonly message: SerialWorkerResponse }) => {
    if (message.message.kind === 'line' && options.lineCostMs !== undefined) {
      blockThisThread(options.lineCostMs);
    }
    for (const handler of handlers) handler(message.message);
  });
  return createWorkerSerialConnection({
    bridge: {
      postMessage: (message: SerialWorkerRequest, transfer) => {
        if (message.kind === 'write') options.windowWrites?.push(message.data);
        thread.postMessage({ channel: 'serial', message }, (transfer ?? []) as ArrayBuffer[]);
      },
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
function usbAdapter(
  thread: Worker,
  transport: StallThreadConfig['transport'],
  options: WorkerOptions,
): PlatformAdapter {
  return {
    id: 'electron',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({
        open: async (request: SerialOpenRequest) =>
          transport === 'usb-worker' && request.hostedStreaming === true
            ? usbWorkerConnection(thread, options)
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

type ThreadReport = Extract<StallThreadMessage, { readonly channel: 'harness' }>;

async function report(thread: Worker): Promise<ThreadReport> {
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

export async function until(condition: () => boolean, ms: number): Promise<void> {
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

export function litMsDuring(
  stops: ReadonlyArray<LitStop>,
  window: { readonly from: number; readonly to: number },
): number {
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

export type StallCase = {
  readonly firmware: StallThreadConfig['firmware'];
  readonly controllerKind: ControllerKind;
  readonly device: Partial<DeviceProfile>;
  readonly program: (device: DeviceProfile) => string;
  readonly streamingMode?: 'ping-pong';
  readonly stallMs: number;
};

export const MARLIN_INLINE: StallCase = {
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
export const MARLIN_FAN: StallCase = {
  ...MARLIN_INLINE,
  device: { controllerKind: 'marlin', maxPowerS: 255, gcodeDialect: { dialectId: 'marlin-fan' } },
};
export const GRBL_COMPATIBLE: StallCase = {
  firmware: 'grbl',
  controllerKind: 'grbl-v1.1',
  device: { controllerKind: 'grbl-v1.1', gcodeDialect: { dialectId: 'grbl-compatible' } },
  program: (device) => grblStrategy.emit(engraveJob(420), device),
  stallMs: 1_000,
};
export const GRBLHAL_COMPATIBLE: StallCase = {
  ...GRBL_COMPATIBLE,
  firmware: 'grblhal',
  controllerKind: 'grblhal',
  device: { controllerKind: 'grblhal', gcodeDialect: { dialectId: 'grbl-compatible' } },
};

export type StallRun = {
  readonly litDuringStall: number;
  readonly stall: { readonly from: number; readonly to: number };
  readonly litStops: ReadonlyArray<LitStop>;
  readonly received: ReadonlyArray<string>;
  readonly arrivals: ReadonlyArray<Arrival>;
  readonly echoes: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly program: string;
  readonly armAcks: ReadonlyArray<string | null>;
  /** Every line this thread asked the worker to write. */
  readonly windowWrites: ReadonlyArray<string>;
};

export type StallOptions = {
  readonly hostedStreaming?: boolean;
  readonly abortAfterStall?: boolean;
  readonly dropCommandLetterOfMove?: number;
  readonly lineCostMs?: number;
  /** How long after the stall the controller keeps being sampled. */
  readonly settleMs?: number;
};

export async function runStall(
  testCase: StallCase,
  transport: StallThreadConfig['transport'],
  options: StallOptions = {},
): Promise<StallRun> {
  const thread = spawn({
    firmware: testCase.firmware,
    transport,
    ...(options.dropCommandLetterOfMove === undefined
      ? {}
      : { dropCommandLetterOfMove: options.dropCommandLetterOfMove }),
  });
  useStore.getState().updateDeviceProfile(testCase.device);
  const device = { ...DEFAULT_DEVICE_PROFILE, ...testCase.device };
  const program = testCase.program(device);
  const windowWrites: string[] = [];
  const workerOptions = {
    windowWrites,
    ...(options.lineCostMs === undefined ? {} : { lineCostMs: options.lineCostMs }),
  };
  const adapter =
    transport === 'network-worker'
      ? networkAdapter(thread)
      : usbAdapter(thread, transport, workerOptions);
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
  const settleUntil = stall.to + (options.settleMs ?? 0);
  await new Promise((settle) => setTimeout(settle, Math.max(200, settleUntil - Date.now())));
  const measured = await report(thread);
  return {
    litDuringStall: litMsDuring(measured.litStops, { from: stall.from, to: stall.to + 50 }),
    stall,
    litStops: measured.litStops,
    received: measured.received.join('').split('\n'),
    arrivals: measured.arrivals,
    echoes: measured.echoes,
    warnings,
    program,
    armAcks: measured.armAcks,
    windowWrites,
  };
}

/** True when `lines` appears in `received` as one unbroken run. */
export function containsRun(
  received: ReadonlyArray<string>,
  lines: ReadonlyArray<string>,
): boolean {
  const start = received.indexOf(lines[0] ?? '');
  return start >= 0 && lines.every((line, index) => received[start + index] === line);
}

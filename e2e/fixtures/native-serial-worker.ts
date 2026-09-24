/// <reference lib="webworker" />
// Ambient Web Serial/Vite declarations have no module exports to import.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../src/vite-env.d.ts" />

import { createNativeSerialWorkerRuntime } from '../../src/platform/web/native-serial-worker-runtime';
import type { NativeSerialWorkerRequest } from '../../src/platform/web/native-serial-worker-protocol';

export interface NativeSerialFixtureSnapshot {
  readonly writes: readonly { readonly time: number; readonly line: string }[];
  readonly acknowledgements: readonly number[];
  readonly heartbeats: readonly number[];
  readonly openOptions: readonly SerialOptions[];
  readonly protocol: readonly { readonly time: number; readonly kind: string }[];
  readonly pending: number;
}

interface FixtureRequest {
  readonly kind: 'fixture-snapshot';
  readonly id: number;
}

const writes: { time: number; line: string }[] = [];
const acknowledgements: number[] = [];
const heartbeats: number[] = [];
const openOptions: SerialOptions[] = [];
const protocol: { time: number; kind: string }[] = [];
const decoder = new TextDecoder();
const encoder = new TextEncoder();
let pending = 0;
let incoming: ReadableStreamDefaultController<Uint8Array> | null = null;
let stopClock = (): void => undefined;
const now = (): number => performance.timeOrigin + performance.now();

function acknowledge(): void {
  heartbeats.push(now());
  if (pending === 0 || incoming === null) return;
  pending--;
  acknowledgements.push(now());
  incoming.enqueue(encoder.encode('ok\n'));
}

function startClock(): () => void {
  const externalClock = new URL(self.location.href).searchParams.get('clock');
  if (externalClock === null) {
    const timer = setInterval(acknowledge, 8);
    return () => clearInterval(timer);
  }
  // A separate Node test server can pace hidden-window probes. Browser timer
  // throttling must not accidentally turn the controller fixture into the bug.
  const controller = new AbortController();
  void (async () => {
    const response = await fetch(externalClock, { signal: controller.signal });
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('The external controller clock has no stream.');
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      for (const byte of value) if (byte === 0x2e) acknowledge();
    }
  })().catch((error: unknown) => {
    if (!controller.signal.aborted) {
      self.postMessage({ kind: 'fixture-clock-error', message: String(error) });
    }
  });
  return () => controller.abort();
}

// The source, sink, controller clock and production transport all live here.
// Nothing needed to acknowledge or refill a line is scheduled on the window.
const port = Object.assign(new EventTarget(), {
  readable: null as ReadableStream<Uint8Array> | null,
  writable: null as WritableStream<Uint8Array> | null,
  getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
  open: async (options: SerialOptions): Promise<void> => {
    openOptions.push(options);
    port.readable = new ReadableStream<Uint8Array>({
      start(controller) {
        incoming = controller;
      },
      cancel() {
        incoming = null;
      },
    });
    port.writable = new WritableStream<Uint8Array>({
      write(bytes) {
        const lines = decoder.decode(bytes).split('\n').filter(Boolean);
        for (const line of lines) {
          writes.push({ time: now(), line });
          pending++;
        }
      },
    });
    stopClock = startClock();
  },
  close: async () => {
    stopClock();
    incoming = null;
  },
});

const runtime = createNativeSerialWorkerRuntime({
  serial: { getPorts: async () => [port] },
  post: (message) => {
    protocol.push({ time: now(), kind: message.kind });
    self.postMessage(message);
  },
});

self.onmessage = (event: MessageEvent<NativeSerialWorkerRequest | FixtureRequest>): void => {
  const message = event.data;
  if (message.kind === 'fixture-snapshot') {
    const snapshot: NativeSerialFixtureSnapshot = {
      writes,
      acknowledgements,
      heartbeats,
      openOptions,
      protocol,
      pending,
    };
    self.postMessage({ kind: 'fixture-snapshot', id: message.id, snapshot });
  } else {
    runtime.handle(message);
  }
};

// The controller's side of the in-window stall test (rolling audit v6 K1,
// ADR-676), bundled by `in-window-stall-beam.thread.test.ts` and run on its own
// node:worker_threads thread with the real clock, the refuter's method. The
// real store runs on the test's main thread, which the test blocks with a
// synchronous busy loop.
//
// The thread holds a controller model and, for the worker transports, the
// production code that refills it: the serial worker core (a worker-owned USB
// port) or the network worker runtime (a desktop network session, with the
// main process's routes faked over the same controller). For the window
// transport it only relays bytes, so every refill waits for the main thread.
//
// It samples the controller every millisecond and records each interval in
// which the head is stopped with the beam above zero, and the time each line
// reached the controller.
//
// `loseFirstByte` models a byte lost on the controller's UART leg (rolling audit
// v8 N1-P1-1 and v9 R1-P1-1, the refuters' method): Marlin reads the chosen line
// without its first letter, echoes it as an unknown command and answers `ok`.

import { createFifoMarlin } from './marlin-fifo-model';
import { createGrblSimulator } from './grbl-simulator';
import { createSerialWorkerCore } from '../../platform/web/serial-worker-core';
import { createNetworkSerialWorkerRuntime } from '../../platform/web/network-serial-worker-runtime';
import type { NetworkSerialWorkerRequest } from '../../platform/web/network-serial-worker-protocol';
import type { SerialWorkerRequest } from '../../platform/web/serial-worker-protocol';
import type { SerialConnection } from '../../platform/types';

export type StallThreadConfig = {
  readonly firmware: 'marlin' | 'grbl' | 'grblhal';
  readonly transport: 'window' | 'usb-worker' | 'network-worker';
  readonly loseFirstByte?: LostByte;
};

/** Which lines reach Marlin without their first byte: those matching `pattern`,
 * or only the `nth` of them (counting from 1). */
export type LostByte = { readonly pattern: string; readonly nth?: number };

export type Arrival = { readonly at: number; readonly line: string };

export type LitStop = { readonly from: number; readonly to: number; readonly beam: number };

export type StallThreadMessage =
  | { readonly channel: 'wire'; readonly line: string }
  | { readonly channel: 'serial'; readonly message: unknown }
  | {
      readonly channel: 'harness';
      readonly kind: 'report';
      readonly litStops: ReadonlyArray<LitStop>;
      readonly received: ReadonlyArray<string>;
      /** When each line reached the controller (the Marlin model only). */
      readonly arrivals: ReadonlyArray<Arrival>;
      /** Every `echo:Unknown command` the controller sent. */
      readonly echoes: ReadonlyArray<string>;
      /** The reply grammar each arm named, in order (ADR-676). */
      readonly armAcks: ReadonlyArray<string | null>;
      /** The controller's own state, printed when a wait times out. */
      readonly controllerState: unknown;
    };

type Port = {
  readonly postMessage: (message: StallThreadMessage, transfer?: ArrayBuffer[]) => void;
  readonly on: (event: 'message', handler: (message: unknown) => void) => void;
};

type Controller = {
  readonly connection: SerialConnection;
  /** The beam if the head is stopped now, else 0. */
  readonly stoppedBeam: () => number;
  readonly boot: () => void;
  readonly received: () => ReadonlyArray<string>;
  readonly arrivals: () => ReadonlyArray<Arrival>;
  readonly debugState: () => unknown;
};

export async function start(port: Port, config: StallThreadConfig): Promise<void> {
  const controller = await openController(config.firmware, config.loseFirstByte);
  const litStops = sampleLitStops(controller);
  const echoes: string[] = [];
  controller.connection.onLine((line) => {
    if (line.startsWith('echo:Unknown command')) echoes.push(line);
  });
  const handleSerial = attachTransport(port, config.transport, controller);
  const armAcks: Array<string | null> = [];
  port.on('message', (raw) => {
    const message = raw as
      | { readonly channel: 'wire'; readonly data: string }
      | { readonly channel: 'serial'; readonly message: { kind?: string; acks?: string } }
      | { readonly channel: 'harness'; readonly kind: 'boot' | 'report' };
    if (message.channel === 'wire') void controller.connection.write(message.data);
    else if (message.channel === 'serial') {
      if (message.message.kind === 'arm') armAcks.push(message.message.acks ?? null);
      handleSerial(message.message);
    } else if (message.kind === 'boot') controller.boot();
    else {
      port.postMessage({
        channel: 'harness',
        kind: 'report',
        litStops: litStops(),
        received: controller.received(),
        arrivals: controller.arrivals(),
        echoes,
        armAcks,
        controllerState: controller.debugState(),
      });
    }
  });
}

async function openController(
  firmware: StallThreadConfig['firmware'],
  loseFirstByte?: LostByte,
): Promise<Controller> {
  const arrivals: Arrival[] = [];
  if (firmware === 'marlin') {
    const marlin = createFifoMarlin();
    const inner = await openFirst(marlin.adapter);
    const corrupt = lineCorrupter(loseFirstByte);
    const connection: SerialConnection = {
      ...inner,
      write: (data) => {
        const at = Date.now();
        const lines = data.split('\n').map(corrupt);
        for (const line of lines.slice(0, -1)) arrivals.push({ at, line });
        return inner.write(lines.join('\n'));
      },
    };
    return {
      arrivals: () => arrivals,
      connection,
      stoppedBeam: () => {
        const state = marlin.state();
        return state.moving ? 0 : Math.max(state.output, state.fan);
      },
      boot: () => marlin.emitLine('start'),
      received: () => marlin.outbound(),
      debugState: () => marlin.state(),
    };
  }
  // Stock GRBL buffers: 15 planner blocks and a 128-byte receive ring, each
  // 0.2 mm move at 1,500 mm/min taking 8 ms (the refuter's GRBL model). The
  // banner waits for `boot`, once the store is listening.
  const banner =
    firmware === 'grblhal' ? "GrblHAL 1.1f ['$' for help]" : "Grbl 1.1h ['$' for help]";
  const sim = createGrblSimulator({
    plannerBlocks: 15,
    blockRetireMs: 8,
    rxBufferBytes: 128,
    emitBannerOnOpen: false,
    firmwareBanner: banner,
  });
  const inner = await openFirst(sim.adapter);
  const beam = grblBeamTracker();
  const connection: SerialConnection = {
    ...inner,
    write: (data) => {
      beam.read(data);
      return inner.write(data);
    },
  };
  return {
    arrivals: () => arrivals,
    connection,
    stoppedBeam: () => (sim.planner().blocks === 0 ? beam.power() : 0),
    boot: () => sim.port.emitLine(banner),
    received: () => sim.outbound(),
    debugState: () => sim.planner(),
  };
}

function lineCorrupter(lost: LostByte | undefined): (line: string) => string {
  if (lost === undefined) return (line) => line;
  const pattern = new RegExp(lost.pattern);
  let matched = 0;
  return (line) => {
    if (!pattern.test(line)) return line;
    matched += 1;
    return lost.nth === undefined || matched === lost.nth ? line.slice(1) : line;
  };
}

async function openFirst(adapter: {
  readonly serial: { readonly requestPort: () => Promise<{ open: SerialOpen } | null> };
}): Promise<SerialConnection> {
  const port = await adapter.serial.requestPort();
  if (port === null) throw new Error('no simulated port');
  return port.open({ baudRate: 115_200 });
}

type SerialOpen = (request: { readonly baudRate: number }) => Promise<SerialConnection>;

// GRBL laser mode at a stop (gnea/grbl stepper.c L392-L397): an M3 block keeps
// S on the PWM; an M4 block and a G0 leave it off. Every line written reaches
// the planner by the time it has drained, so the modal state after them all is
// the state at the stop.
function grblBeamTracker(): {
  readonly read: (data: string) => void;
  readonly power: () => number;
} {
  let spindle: 'cw' | 'ccw' | 'off' = 'off';
  let power = 0;
  let motion = 0;
  let partial = '';
  const line = (text: string): void => {
    const code = text.toUpperCase();
    for (const m of code.matchAll(/M0*(\d+)/g)) {
      const value = Number(m[1]);
      if (value === 3) spindle = 'cw';
      else if (value === 4) spindle = 'ccw';
      else if (value === 5 || value === 2 || value === 30) spindle = 'off';
    }
    const s = /S(\d+(?:\.\d+)?)/.exec(code);
    if (s !== null) power = Number(s[1]);
    const g = /G0*([0-3])(?!\d)/.exec(code);
    if (g !== null) motion = Number(g[1]);
  };
  return {
    read: (data) => {
      for (const char of data) {
        if (char === '\n') {
          line(partial);
          partial = '';
        } else if (char.charCodeAt(0) < 0x80 && char !== '?' && char !== '\r') partial += char;
      }
    },
    power: () => (spindle === 'cw' && motion !== 0 ? power : 0),
  };
}

function sampleLitStops(controller: Controller): () => ReadonlyArray<LitStop> {
  const intervals: LitStop[] = [];
  let open: { from: number; beam: number } | null = null;
  setInterval(() => {
    const now = Date.now();
    const beam = controller.stoppedBeam();
    if (beam > 0 && open === null) open = { from: now, beam };
    else if (beam === 0 && open !== null) {
      intervals.push({ from: open.from, to: now, beam: open.beam });
      open = null;
    }
  }, 1);
  return () => [
    ...intervals,
    ...(open === null ? [] : [{ from: open.from, to: Date.now(), beam: open.beam }]),
  ];
}

function attachTransport(
  port: Port,
  transport: StallThreadConfig['transport'],
  controller: Controller,
): (message: unknown) => void {
  if (transport === 'window') {
    controller.connection.onLine((line) => port.postMessage({ channel: 'wire', line }));
    return () => undefined;
  }
  if (transport === 'usb-worker') return usbWorker(port, controller);
  return networkWorker(port, controller);
}

// A worker-owned port (ADR-354): the serial worker core reads and writes the
// controller here; the main thread only receives forwarded lines.
function usbWorker(port: Port, controller: Controller): (message: unknown) => void {
  let feed: ReadableStreamDefaultController<Uint8Array> | null = null;
  const readable = new ReadableStream<Uint8Array>({
    start: (controllerStream) => {
      feed = controllerStream;
    },
  });
  controller.connection.onLine((line) => {
    try {
      feed?.enqueue(Uint8Array.from(`${line}\n`, (char) => char.charCodeAt(0) & 0xff));
    } catch {
      // The core cancelled its reader on close.
    }
  });
  const writable = new WritableStream<Uint8Array>({
    write: (bytes) => controller.connection.write(String.fromCharCode(...bytes)),
  });
  const core = createSerialWorkerCore({
    post: (message) => port.postMessage({ channel: 'serial', message }),
  });
  return (message) => {
    const request = message as SerialWorkerRequest | { readonly kind: 'harness-start' };
    if (request.kind === 'harness-start') core.handle({ kind: 'attach', readable, writable });
    else core.handle(request);
  };
}

// A desktop network session (ADR-676): the network worker runtime reads and
// writes it through faked main-process routes over this controller.
function networkWorker(port: Port, controller: Controller): (message: unknown) => void {
  let inbound = '';
  let waiting: (() => void) | null = null;
  controller.connection.onLine((line) => {
    inbound += `${line}\n`;
    waiting?.();
  });
  const fetchRoute = async (input: unknown, init?: { readonly body?: unknown }) => {
    const action = String(input).split('/').pop();
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (action === 'read') {
      if (inbound === '') {
        await new Promise<void>((resolve) => {
          waiting = resolve;
          setTimeout(resolve, 50);
        });
        waiting = null;
      }
      const data = btoa(inbound);
      inbound = '';
      return Response.json({ data, closed: false });
    }
    if (action === 'write') await controller.connection.write(atob(String(body['data'])));
    return Response.json({ written: true });
  };
  const runtime = createNetworkSerialWorkerRuntime({
    post: (message) => port.postMessage({ channel: 'serial', message }),
    fetch: fetchRoute as typeof fetch,
  });
  return (message) => runtime.handle(message as NetworkSerialWorkerRequest);
}

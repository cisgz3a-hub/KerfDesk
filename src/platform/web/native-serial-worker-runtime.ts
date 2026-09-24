import type { SerialPortIdentity } from '../types';
import { createSerialWorkerCore, type SerialWorkerCore } from './serial-worker-core';
import type {
  NativeSerialWorkerRequest,
  NativeSerialWorkerResponse,
} from './native-serial-worker-protocol';

type RuntimeDeps = {
  readonly serial: Pick<Serial, 'getPorts'> | null;
  readonly post: (message: NativeSerialWorkerResponse) => void;
};

type Probe = {
  readonly id: number;
  readonly identity: SerialPortIdentity;
  readonly port: SerialPort;
};
type Phase = 'idle' | 'probing' | 'ready' | 'opening' | 'opened' | 'started' | 'closing' | 'closed';
type RuntimeState = {
  phase: Phase;
  probe: Probe | null;
  port: SerialPort | null;
  opening: Promise<void> | null;
  closing: Promise<void> | null;
  streams: {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
  } | null;
};

export type NativeSerialWorkerRuntime = {
  readonly handle: (request: NativeSerialWorkerRequest) => void;
  readonly close: () => Promise<void>;
};

/** The picker stays on the window, but the selected native port and both
 * stream algorithms belong to this worker. A probe never opens a device. */
export function createNativeSerialWorkerRuntime(deps: RuntimeDeps): NativeSerialWorkerRuntime {
  const state: RuntimeState = {
    phase: 'idle',
    probe: null,
    port: null,
    opening: null,
    closing: null,
    streams: null,
  };
  const core = createSerialWorkerCore({
    onClosing: () => void close(),
    post: (message) => {
      if (message.kind === 'closed') void close();
      else if (message.kind === 'read-error')
        readOnAfterLineError(state, core, close, message.name);
      else if (state.phase !== 'closed') deps.post(message);
    },
  });
  const close = (): Promise<void> => {
    if (state.closing !== null) return state.closing;
    state.phase = 'closing';
    // Install the promise before notifying the client. An in-process bridge
    // may respond with close synchronously, and must join this same cleanup.
    state.closing = Promise.resolve().then(() => closeRuntime(state, core, deps, onDisconnect));
    deps.post({ kind: 'native-closing' });
    return state.closing;
  };
  const onDisconnect = (): void => {
    void close();
  };
  return {
    handle: (request) => handleRequest(state, core, deps, close, onDisconnect, request),
    close,
  };
}

function handleRequest(
  state: RuntimeState,
  core: SerialWorkerCore,
  deps: RuntimeDeps,
  close: () => Promise<void>,
  onDisconnect: () => void,
  request: NativeSerialWorkerRequest,
): void {
  if (request.kind === 'close') {
    void close();
  } else if (state.phase === 'closing' || state.phase === 'closed') {
    return;
  } else if (request.kind === 'native-probe') {
    if (state.phase === 'idle') void probePort(state, deps, request);
  } else if (request.kind === 'native-open') {
    if (state.phase !== 'ready' || request.id !== state.probe?.id) return;
    state.phase = 'opening';
    state.opening = openPort(state, deps, onDisconnect, request).catch((error: unknown) => {
      if (state.phase !== 'closing') {
        deps.post({ kind: 'native-open-error', id: request.id, message: describeError(error) });
      }
      void close();
    });
  } else if (request.kind === 'native-start') {
    startReading(state, core, close);
  } else {
    forwardRequest(state, core, deps, close, request);
  }
}

async function probePort(
  state: RuntimeState,
  deps: RuntimeDeps,
  request: Extract<NativeSerialWorkerRequest, { readonly kind: 'native-probe' }>,
): Promise<void> {
  state.phase = 'probing';
  let candidate: SerialPort | null = null;
  try {
    candidate = await uniqueMatchingPort(deps.serial, request.identity);
  } catch {
    // No native open has been attempted; the original window port remains usable.
  }
  if (state.phase !== 'probing') return;
  if (candidate === null) {
    state.phase = 'closed';
    deps.post({
      kind: 'native-unavailable',
      id: request.id,
      reason: 'The selected USB serial port is not uniquely available in this worker.',
    });
    return;
  }
  state.probe = { id: request.id, identity: request.identity, port: candidate };
  state.phase = 'ready';
  deps.post({ kind: 'native-ready', id: request.id });
}

async function openPort(
  state: RuntimeState,
  deps: RuntimeDeps,
  onDisconnect: () => void,
  request: Extract<NativeSerialWorkerRequest, { readonly kind: 'native-open' }>,
): Promise<void> {
  const probe = state.probe;
  if (probe === null) throw new Error('The serial worker has no selected port.');
  const candidate = await uniqueMatchingPort(deps.serial, probe.identity);
  if (state.phase !== 'opening') return;
  // VID/PID identify an adapter model, not a unit. Reuse the exact wrapper
  // enumerated during the probe, and refuse replacement or new ambiguity.
  if (candidate === null || candidate !== probe.port) {
    throw new Error('The selected serial port changed before the worker could open it.');
  }
  state.port = candidate;
  candidate.addEventListener('disconnect', onDisconnect);
  await candidate.open(request.options);
  if (state.phase !== 'opening') return;
  const readable = candidate.readable;
  const writable = candidate.writable;
  if (readable === null || writable === null)
    throw new Error('The native serial port is not open.');
  state.streams = { readable, writable };
  state.phase = 'opened';
  deps.post({ kind: 'native-opened', id: request.id });
}

function startReading(
  state: RuntimeState,
  core: SerialWorkerCore,
  close: () => Promise<void>,
): void {
  if (state.phase === 'started') return;
  if (state.phase !== 'opened' || state.streams === null) {
    void close();
    return;
  }
  state.phase = 'started';
  try {
    core.handle({ kind: 'attach', ...state.streams });
  } catch {
    void close();
  }
}

// A UART line error (framing, parity, break, overrun) errored the port's
// readable but left the port open, and the Web Serial spec hands out a fresh
// readable on the next access (audit connect-1, serial-read-recovery.ts). This
// worker owns the port, so it reads on from that stream itself; a window-realm
// stream is never accepted here. The core keeps its writer and any armed
// refill, and its recovery budget still ends a port that fails every stream.
// No fresh readable ends the session as a dropped cable would.
function readOnAfterLineError(
  state: RuntimeState,
  core: SerialWorkerCore,
  close: () => Promise<void>,
  errorName: string,
): void {
  const readable = state.phase === 'started' ? (state.port?.readable ?? null) : null;
  if (readable === null || readable.locked) {
    void close();
    return;
  }
  try {
    core.handle({ kind: 'reattach-readable', readable });
    console.warn(`Serial line error (${errorName}); the port is still open, so reading continues.`);
  } catch {
    void close();
  }
}

function forwardRequest(
  state: RuntimeState,
  core: SerialWorkerCore,
  deps: RuntimeDeps,
  close: () => Promise<void>,
  request: Exclude<NativeSerialWorkerRequest, { readonly kind: `native-${string}` }>,
): void {
  if (state.phase === 'started') {
    try {
      core.handle(request);
    } catch {
      void close();
    }
  } else if (request.kind === 'write') {
    deps.post({ kind: 'write-error', id: request.id, message: 'Serial worker has not started.' });
  } else {
    void close();
  }
}

async function closeRuntime(
  state: RuntimeState,
  core: SerialWorkerCore,
  deps: RuntimeDeps,
  onDisconnect: () => void,
): Promise<void> {
  await state.opening;
  await core.close();
  const port = state.port;
  if (port !== null) {
    port.removeEventListener('disconnect', onDisconnect);
    await port.close().catch(() => undefined);
  }
  state.port = null;
  state.streams = null;
  state.probe = null;
  state.phase = 'closed';
  deps.post({ kind: 'closed' });
}

async function uniqueMatchingPort(
  serial: RuntimeDeps['serial'],
  identity: SerialPortIdentity,
): Promise<SerialPort | null> {
  if (serial === null || !validUsbId(identity.usbVendorId) || !validUsbId(identity.usbProductId)) {
    return null;
  }
  const matches = (await serial.getPorts()).filter((port) => {
    const info = port.getInfo();
    return info.usbVendorId === identity.usbVendorId && info.usbProductId === identity.usbProductId;
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function validUsbId(value: number | undefined): boolean {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

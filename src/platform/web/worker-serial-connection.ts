// The renderer's half of the worker-hosted transport (ADR-334).
//
// Presents the ordinary `SerialConnection` the whole app already talks to, so
// nothing upstream knows or cares that the bytes are read in a worker: lines
// arrive through `onLine` in wire order, `write` still resolves only once the
// bytes are queued, and `close` still leaves the port closable.
//
// The one addition is `hostedStreaming`, through which the job stream hands
// the character-counting refill to the worker and takes it back. Both
// directions wait for the worker's own acknowledgement, and postMessage
// preserves order, so the two sides can never both be writing refills:
//
//   main writes refills ──arm──▶ (still main) ──armed──▶ worker writes refills
//   worker writes refills ─release─▶ (still worker) ──released──▶ main writes
//
// Every wait is bounded. A worker that stops answering must not be able to
// hang Disconnect, which is the lesson `bounded-writer-close.ts` already
// records for the main-thread transport.

import type { HostedStreamRefill, SerialConnection } from '../types';
import {
  isSerialWorkerResponse,
  type SerialWorkerRequest,
  type SerialWorkerResponse,
} from './serial-worker-protocol';

/** The minimum of a `Worker` this transport uses, so a test can supply a fake
 * and the production path can supply the real thing. */
export type SerialWorkerBridge = {
  readonly postMessage: (message: SerialWorkerRequest, transfer?: ReadonlyArray<unknown>) => void;
  readonly onMessage: (handler: (message: SerialWorkerResponse) => void) => () => void;
  readonly terminate: () => void;
};

export type WorkerSerialPort = {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  readonly close: () => Promise<void>;
  readonly forget?: () => Promise<void>;
};

/** How long any one handshake may take before the transport stops waiting on
 * the worker. Generous next to a message round trip, short next to a person. */
export const WORKER_HANDSHAKE_TIMEOUT_MS = 2_000;

type PendingWrite = { readonly resolve: () => void; readonly reject: (error: Error) => void };

type Session = {
  closed: boolean;
  armed: boolean;
  nextWriteId: number;
  armedSignal: (() => void) | null;
  releasedSignal: (() => void) | null;
  closedSignal: (() => void) | null;
  readonly lineSubs: Set<(line: string) => void>;
  readonly closeSubs: Set<() => void>;
  readonly writeErrorSubs: Set<(message: string) => void>;
  readonly pendingWrites: Map<number, PendingWrite>;
};

export function createWorkerSerialConnection(args: {
  readonly bridge: SerialWorkerBridge;
  readonly port: WorkerSerialPort;
  readonly timeoutMs?: number;
}): SerialConnection {
  const { bridge, port } = args;
  const timeoutMs = args.timeoutMs ?? WORKER_HANDSHAKE_TIMEOUT_MS;
  const session = createSession();
  const unsubscribe = bridge.onMessage((message) => {
    if (isSerialWorkerResponse(message)) routeResponse(session, message);
  });
  attachStreams(bridge, port, unsubscribe);
  const hostedStreaming = createHostedRefill(session, bridge, timeoutMs);
  const shutDown = async (): Promise<void> => {
    if (!session.closed) {
      // The worker holds the stream locks, so it must let go before the port
      // can be closed here.
      await settleWithin(timeoutMs, (done) => {
        session.closedSignal = done;
        bridge.postMessage({ kind: 'close' });
      });
      session.closedSignal = null;
      fireClose(session);
    }
    unsubscribe();
    bridge.terminate();
  };

  return {
    write: async (data) => {
      if (session.closed) throw new Error('Serial port not writable.');
      const id = session.nextWriteId++;
      return new Promise<void>((resolve, reject) => {
        session.pendingWrites.set(id, { resolve, reject });
        bridge.postMessage({ kind: 'write', id, data });
      });
    },
    onLine: (handler) => subscribe(session.lineSubs, handler),
    onClose: (handler) => subscribe(session.closeSubs, handler),
    close: async () => {
      if (session.closed) return;
      await shutDown();
      await port.close().catch((err: unknown) => {
        console.warn('port.close() rejected:', err);
      });
    },
    forget: async () => {
      await hostedStreaming.release();
      await shutDown();
      await port.close().catch(() => undefined);
      await port.forget?.().catch((err: unknown) => {
        console.warn('port.forget() rejected:', err);
      });
    },
    hostedStreaming,
  };
}

function createSession(): Session {
  return {
    closed: false,
    armed: false,
    nextWriteId: 1,
    armedSignal: null,
    releasedSignal: null,
    closedSignal: null,
    lineSubs: new Set(),
    closeSubs: new Set(),
    writeErrorSubs: new Set(),
    pendingWrites: new Map(),
  };
}

function attachStreams(
  bridge: SerialWorkerBridge,
  port: WorkerSerialPort,
  unsubscribe: () => void,
): void {
  const readable = port.readable;
  const writable = port.writable;
  if (readable === null || writable === null) {
    unsubscribe();
    throw new Error('Serial port is not open for the worker transport.');
  }
  try {
    // A runtime that cannot transfer streams throws here, synchronously and
    // before either stream is locked, so the caller can still build the
    // ordinary main-thread connection from the same port.
    bridge.postMessage({ kind: 'attach', readable, writable }, [readable, writable]);
  } catch (error) {
    unsubscribe();
    bridge.terminate();
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function routeResponse(session: Session, message: SerialWorkerResponse): void {
  if (message.kind === 'line') {
    deliverLine(session, message.line);
    return;
  }
  if (routeHandover(session, message)) return;
  if (routeWriteResult(session, message)) return;
  if (message.kind === 'stream-write-error') {
    for (const handler of session.writeErrorSubs) handler(message.message);
    return;
  }
  session.closedSignal?.();
  session.closedSignal = null;
  fireClose(session);
}

/** The refill handover, the only thing that moves write ownership. */
function routeHandover(session: Session, message: SerialWorkerResponse): boolean {
  if (message.kind === 'armed') {
    session.armed = true;
    session.armedSignal?.();
    session.armedSignal = null;
    return true;
  }
  if (message.kind === 'released') {
    session.armed = false;
    session.releasedSignal?.();
    session.releasedSignal = null;
    return true;
  }
  return false;
}

function routeWriteResult(session: Session, message: SerialWorkerResponse): boolean {
  if (message.kind === 'write-ack') {
    session.pendingWrites.get(message.id)?.resolve();
    session.pendingWrites.delete(message.id);
    return true;
  }
  if (message.kind === 'write-error') {
    session.pendingWrites.get(message.id)?.reject(new Error(message.message));
    session.pendingWrites.delete(message.id);
    return true;
  }
  return false;
}

// Isolated exactly as the main-thread transport isolates them: one throwing
// subscriber must not look like a dropped cable.
function deliverLine(session: Session, line: string): void {
  for (const handler of session.lineSubs) {
    try {
      handler(line);
    } catch (err) {
      console.error('Serial line handler threw; continuing with remaining lines:', err);
    }
  }
}

function fireClose(session: Session): void {
  if (session.closed) return;
  session.closed = true;
  session.armed = false;
  for (const write of session.pendingWrites.values())
    write.reject(new Error('Serial port closed before the write completed.'));
  session.pendingWrites.clear();
  for (const handler of session.closeSubs) handler();
}

function createHostedRefill(
  session: Session,
  bridge: SerialWorkerBridge,
  timeoutMs: number,
): HostedStreamRefill {
  return {
    isArmed: () => session.armed,
    arm: async (streamer) => {
      if (session.closed || session.armed) return;
      await settleWithin(timeoutMs, (done) => {
        session.armedSignal = done;
        bridge.postMessage({ kind: 'arm', streamer: streamer as never });
      });
      session.armedSignal = null;
    },
    release: async () => {
      if (session.closed || !session.armed) {
        session.armed = false;
        return;
      }
      await settleWithin(timeoutMs, (done) => {
        session.releasedSignal = done;
        bridge.postMessage({ kind: 'release' });
      });
      session.releasedSignal = null;
      // A worker that never answered must not keep the refill: the main thread
      // resumes writing rather than leaving the stream with no writer at all.
      session.armed = false;
    },
    onWriteError: (handler) => subscribe(session.writeErrorSubs, handler),
  };
}

function subscribe<T>(subscribers: Set<T>, handler: T): () => void {
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

/** Run `begin`, then resolve on its callback or on the deadline — whichever
 * comes first. Never rejects: a silent worker is handled by the caller's own
 * fallback, not by an unhandled rejection on a teardown path. */
async function settleWithin(timeoutMs: number, begin: (done: () => void) => void): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    begin(finish);
  });
}

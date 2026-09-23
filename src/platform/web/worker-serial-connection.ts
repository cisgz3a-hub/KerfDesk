// The renderer's half of the worker-hosted transport (ADR-334).
//
// Presents the ordinary `SerialConnection` the whole app already talks to, so
// nothing upstream knows or cares that the bytes are read in a worker: lines
// arrive through `onLine` in wire order, `write` still resolves only once the
// bytes are queued, and `close` still leaves the port closable.
//
// Handover establishes a line-delivery barrier before sampling the renderer.
// A timed-out handover closes the transport; it never creates a second writer.

import type { HostedStreamRefill, SerialConnection } from '../types';
import { createWorkerRefillHandover } from './worker-refill-handover';
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
  readonly onError?: (handler: () => void) => () => void;
  /** Native EOF can precede an OS close that never settles. Bound that cleanup. */
  readonly onClosing?: (handler: () => void) => () => void;
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
  closing: boolean;
  nextWriteId: number;
  handover: ReturnType<typeof createWorkerRefillHandover> | null;
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
  /** A native worker already owns the port; start its reader after subscribing. */
  readonly start?: () => void;
}): SerialConnection {
  const { bridge, port } = args;
  const timeoutMs = args.timeoutMs ?? WORKER_HANDSHAKE_TIMEOUT_MS;
  const session = createSession();
  let closingPort: Promise<void> | null = null;
  const closePort = (): Promise<void> => (closingPort ??= port.close());
  let unsubscribeError = (): void => undefined;
  let unsubscribeClosing = (): void => undefined;
  const unsubscribe = bridge.onMessage((message) => {
    if (isSerialWorkerResponse(message)) routeResponse(session, message);
    if (message.kind === 'closed') {
      terminate();
      void closePort().catch(() => undefined);
    }
  });
  let terminated = false;
  const terminate = (): void => {
    if (terminated) return;
    terminated = true;
    unsubscribe();
    unsubscribeError();
    unsubscribeClosing();
    bridge.terminate();
  };
  const fail = (): void => {
    // Termination retires the native worker's port as well as its refill queue.
    // A crashed worker must reject writes and notify the store exactly once.
    terminate();
    fireClose(session);
    void closePort().catch(() => undefined);
  };
  session.handover = createWorkerRefillHandover({
    post: (message) => bridge.postMessage(message),
    timeoutMs,
    onWriteError: (handler) => subscribe(session.writeErrorSubs, handler),
    fail,
  });
  const shutDown = createShutdown(session, bridge, timeoutMs, fail, terminate);
  unsubscribeClosing =
    bridge.onClosing?.(() => {
      void shutDown()
        .then(closePort)
        .catch(() => undefined);
    }) ?? unsubscribeClosing;
  unsubscribeError = bridge.onError?.(fail) ?? unsubscribeError;
  try {
    if (session.closed) throw new Error('Serial worker failed before starting.');
    if (args.start === undefined) attachStreams(bridge, port, unsubscribe);
    else args.start();
  } catch (error) {
    fail();
    throw error;
  }
  return connectionApi({
    session,
    bridge,
    port,
    shutDown,
    closePort,
    fail,
    hostedStreaming: session.handover.refill,
  });
}

function createShutdown(
  session: Session,
  bridge: SerialWorkerBridge,
  timeoutMs: number,
  fail: () => void,
  terminate: () => void,
): () => Promise<void> {
  let closing: Promise<void> | null = null;
  return () => {
    session.closing = true;
    session.handover?.close();
    // Install the promise before posting: an in-process bridge can acknowledge
    // or re-enter close synchronously. The final acknowledgement means the
    // worker released its streams and native port; otherwise the deadline wins.
    closing ??= Promise.resolve().then(async () => {
      if (!session.closed) {
        await settleWithin(timeoutMs, (done) => {
          session.closedSignal = done;
          try {
            bridge.postMessage({ kind: 'close' });
          } catch {
            fail();
            done();
          }
        });
        session.closedSignal = null;
        fireClose(session);
      }
      terminate();
    });
    return closing;
  };
}

function connectionApi({
  session,
  bridge,
  port,
  shutDown,
  closePort,
  fail,
  hostedStreaming,
}: {
  readonly session: Session;
  readonly bridge: SerialWorkerBridge;
  readonly port: WorkerSerialPort;
  readonly shutDown: () => Promise<void>;
  readonly closePort: () => Promise<void>;
  readonly fail: () => void;
  readonly hostedStreaming: HostedStreamRefill;
}): SerialConnection {
  return {
    write: async (data) => {
      if (session.closed || session.closing) throw new Error('Serial port not writable.');
      const id = session.nextWriteId++;
      return new Promise<void>((resolve, reject) => {
        session.pendingWrites.set(id, { resolve, reject });
        try {
          bridge.postMessage({ kind: 'write', id, data });
        } catch {
          fail();
        }
      });
    },
    onLine: (handler) => subscribe(session.lineSubs, handler),
    onClose: (handler) => subscribe(session.closeSubs, handler),
    close: async () => {
      await shutDown();
      await closePort().catch((err: unknown) => {
        console.warn('port.close() rejected:', err);
      });
    },
    forget: async () => {
      await hostedStreaming.release();
      await shutDown();
      await closePort().catch(() => undefined);
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
    closing: false,
    nextWriteId: 1,
    handover: null,
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
  if (session.closed) return;
  if (message.kind === 'line') {
    deliverLine(session, message.line);
    return;
  }
  if (session.handover?.receive(message)) return;
  if (routeWriteResult(session, message)) return;
  if (message.kind === 'stream-write-error') {
    for (const handler of session.writeErrorSubs) handler(message.message);
    return;
  }
  session.closedSignal?.();
  session.closedSignal = null;
  fireClose(session);
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
  session.handover?.close();
  session.closedSignal?.();
  session.closedSignal = null;
  for (const write of session.pendingWrites.values())
    write.reject(new Error('Serial port closed before the write completed.'));
  session.pendingWrites.clear();
  for (const handler of session.closeSubs) {
    try {
      handler();
    } catch (error) {
      console.error('Serial close handler threw; continuing transport cleanup:', error);
    }
  }
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

// The renderer's half of the worker-hosted transport (ADR-334).
//
// Presents the ordinary `SerialConnection` the whole app already talks to, so
// nothing upstream knows or cares that the bytes are read in a worker: lines
// arrive through `onLine` in wire order, `write` still resolves only once the
// bytes are queued, and `close` still leaves the port closable.
//
// Handover establishes a line-delivery barrier before sampling the renderer.
// A timed-out handover closes the transport; it never creates a second writer.
//
// Teardown is one path, whoever starts it: Disconnect, Forget, a failed
// handover, or the worker reporting that its read side ended by itself. The
// worker lets go of both streams, the worker is stopped, the port's own
// streams finish draining through the transfer pipes, and only then is the
// port closed (audit transport-3, transport-4).
//
// A native worker (ADR-354) owns its port outright: it is started instead of
// handed streams, announces its own cleanup, and closes its port before it
// acknowledges `close`.

import type { HostedStreamRefill, SerialConnection } from '../types';
import { createWorkerRefillHandover } from './worker-refill-handover';
import { portStreamsReleased, settleWithin } from './worker-teardown-waits';
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
  /** Teardown began: no new write may reach the worker. */
  closing: boolean;
  /** The worker reported `closed`: it has already let go of both streams. */
  workerReleased: boolean;
  nextWriteId: number;
  handover: ReturnType<typeof createWorkerRefillHandover> | null;
  closedSignal: (() => void) | null;
  readonly lineSubs: Set<(line: string) => void>;
  readonly closeSubs: Set<() => void>;
  readonly writeErrorSubs: Set<(message: string) => void>;
  readonly pendingWrites: Map<number, PendingWrite>;
};

type Link = {
  readonly bridge: SerialWorkerBridge;
  readonly port: WorkerSerialPort;
  readonly timeoutMs: number;
  readonly session: Session;
  unsubscribe: () => void;
  unsubscribeError: () => void;
  unsubscribeClosing: () => void;
  terminated: boolean;
  /** The one teardown run; every later caller awaits the same promise. */
  ending: Promise<void> | null;
};

export function createWorkerSerialConnection(args: {
  readonly bridge: SerialWorkerBridge;
  readonly port: WorkerSerialPort;
  readonly timeoutMs?: number;
  /** A native worker already owns the port; start its reader after subscribing. */
  readonly start?: () => void;
}): SerialConnection {
  const link: Link = {
    bridge: args.bridge,
    port: args.port,
    timeoutMs: args.timeoutMs ?? WORKER_HANDSHAKE_TIMEOUT_MS,
    session: createSession(),
    unsubscribe: () => undefined,
    unsubscribeError: () => undefined,
    unsubscribeClosing: () => undefined,
    terminated: false,
    ending: null,
  };
  const { session } = link;
  link.unsubscribe = link.bridge.onMessage((message) => {
    if (isSerialWorkerResponse(message)) routeResponse(link, message);
  });
  if (args.start === undefined) attachStreams(link.bridge, link.port, link.unsubscribe);
  // An unanswered handover, a crashed worker, or a post the worker can no
  // longer take leaves ownership uncertain. Stop the worker before notifying
  // the store, so no fallback can duplicate its writes; termination also
  // retires a native worker's port and refill queue.
  const fail = (): void => {
    terminate(link);
    fireClose(session);
    void endSession(link);
  };
  session.handover = createWorkerRefillHandover({
    // A program's buffers are transferred, never copied (ADR-354 Amendment 3).
    post: (message, transfer) => link.bridge.postMessage(message, transfer),
    timeoutMs: link.timeoutMs,
    onWriteError: (handler) => subscribe(session.writeErrorSubs, handler),
    fail,
  });
  link.unsubscribeClosing =
    link.bridge.onClosing?.(() => void endSession(link)) ?? link.unsubscribeClosing;
  link.unsubscribeError = link.bridge.onError?.(fail) ?? link.unsubscribeError;
  if (args.start !== undefined) startNative(session, args.start, fail);
  return connectionApi(link, session.handover.refill, fail);
}

function startNative(session: Session, start: () => void, fail: () => void): void {
  try {
    if (session.closed) throw new Error('Serial worker failed before starting.');
    start();
  } catch (error) {
    fail();
    throw error;
  }
}

function connectionApi(
  link: Link,
  hostedStreaming: HostedStreamRefill,
  fail: () => void,
): SerialConnection {
  const { session } = link;
  return {
    write: async (data) => {
      if (session.closed || session.closing) throw new Error('Serial port not writable.');
      const id = session.nextWriteId++;
      return new Promise<void>((resolve, reject) => {
        session.pendingWrites.set(id, { resolve, reject });
        try {
          link.bridge.postMessage({ kind: 'write', id, data });
        } catch {
          fail();
        }
      });
    },
    onLine: (handler) => subscribe(session.lineSubs, handler),
    onClose: (handler) => subscribe(session.closeSubs, handler),
    // Still stops the worker and closes the port after the worker ended the
    // session itself: returning early there leaked the worker and left the
    // port open for the next Connect (audit transport-3).
    close: () => endSession(link),
    forget: async () => {
      await hostedStreaming.release();
      await endSession(link);
      await link.port.forget?.().catch((err: unknown) => {
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
    workerReleased: false,
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

function endSession(link: Link): Promise<void> {
  if (link.ending !== null) return link.ending;
  link.session.closing = true;
  link.session.handover?.close();
  // Install the promise before the run starts, which asks the worker to let go
  // synchronously: an in-process bridge can answer or re-enter close at once,
  // and must join this same teardown.
  let resolveEnd: () => void = () => undefined;
  let rejectEnd: (error: unknown) => void = () => undefined;
  link.ending = new Promise<void>((resolve, reject) => {
    resolveEnd = resolve;
    rejectEnd = reject;
  });
  void runEndSession(link).then(resolveEnd, rejectEnd);
  return link.ending;
}

async function runEndSession(link: Link): Promise<void> {
  const { session } = link;
  // The worker holds the stream locks, so it must let go before the port can
  // be closed here. Skipped when it already has (its read side ended by
  // itself) or can no longer answer (stopped after a failed handover). The
  // acknowledgement means the worker released its streams, and a native
  // worker its port; otherwise the deadline wins.
  if (!session.workerReleased && !link.terminated) {
    await settleWithin(link.timeoutMs, (done) => {
      session.closedSignal = done;
      try {
        link.bridge.postMessage({ kind: 'close' });
      } catch {
        // The worker cannot be asked; stop it rather than wait out the deadline.
        terminate(link);
        done();
      }
    });
    session.closedSignal = null;
  }
  fireClose(session);
  terminate(link);
  // Stopping the worker does not finish the port's own streams: they stay
  // locked by the transfer pipes until the drain the worker's close started
  // is done, and closing the port before then fails (audit transport-4).
  await portStreamsReleased(link.port);
  await link.port.close().catch((err: unknown) => {
    console.warn('port.close() rejected:', err);
  });
}

function terminate(link: Link): void {
  if (link.terminated) return;
  link.terminated = true;
  link.unsubscribe();
  link.unsubscribeError();
  link.unsubscribeClosing();
  link.bridge.terminate();
}

function routeResponse(link: Link, message: SerialWorkerResponse): void {
  const { session } = link;
  // Routed even once the session is closed: a teardown may be waiting on it.
  if (message.kind === 'closed') {
    workerClosed(link);
    return;
  }
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
  if (message.kind === 'read-error') reattachReadable(link, message.name);
}

// The worker has let go of both streams. Either a teardown asked it to, or its
// read side ended by itself (the cable was pulled, or a read failed for good).
// The store learns of the second at once, as a dropped cable, and the rest of
// the teardown follows so the next Connect finds the port closed.
function workerClosed(link: Link): void {
  const { session } = link;
  session.workerReleased = true;
  const requested = session.closedSignal;
  session.closedSignal = null;
  if (requested !== null) {
    requested();
    return;
  }
  fireClose(session);
  void endSession(link);
}

// A UART line error ended the worker's read stream but left the port open,
// and `port.readable` is already a fresh stream (Web Serial spec; see
// serial-read-recovery.ts). Only this thread can reach it, so hand it over;
// the worker kept its writer and any armed refill (audit connect-1). A port
// with no free readable, or a runtime that refuses the transfer, ends the
// session as a dropped cable would, never with a second reader.
function reattachReadable(link: Link, errorName: string): void {
  if (link.ending !== null) return;
  const readable = link.port.readable;
  if (readable !== null && !readable.locked) {
    try {
      link.bridge.postMessage({ kind: 'reattach-readable', readable }, [readable]);
      console.warn(
        `Serial line error (${errorName}); the port is still open, so reading continues.`,
      );
      return;
    } catch (error) {
      console.warn("The serial worker could not take the port's fresh readable:", error);
    }
  }
  fireClose(link.session);
  void endSession(link);
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

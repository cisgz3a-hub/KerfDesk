// The window's half of a worker-streamed desktop network session (ADR-675).
// The desktop adapter opens the session, then offers it here. The worker takes
// it only once its own first read succeeds; until then nothing has been read,
// so a worker that cannot start leaves the session to the window's transport.
// Once it has taken the session the worker is its only reader and writer, so a
// later failure closes the connection instead (ADR-354 decision 3).

import type { HostedNetworkSessionOpener, SerialConnection } from '../types';
import {
  createWorkerSerialConnection,
  WORKER_HANDSHAKE_TIMEOUT_MS,
} from './worker-serial-connection';
import { isSerialWorkerResponse } from './serial-worker-protocol';
import {
  NETWORK_ATTACH_READ_TIMEOUT_MS,
  type NetworkSerialWorkerRequest,
  type NetworkSerialWorkerResponse,
} from './network-serial-worker-protocol';

type NetworkWorker = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>;

/** The worker's first read waits up to a second on the main process. */
const ATTACH_TIMEOUT_MS = NETWORK_ATTACH_READ_TIMEOUT_MS + 500;

export function createNetworkSessionOpener(
  createWorker: () => NetworkWorker = () =>
    new Worker(new URL('./network-serial-stream-worker.ts', import.meta.url), { type: 'module' }),
  timeoutMs: number = WORKER_HANDSHAKE_TIMEOUT_MS,
): HostedNetworkSessionOpener {
  return async ({ sessionId, route, acks }) => {
    let worker: NetworkWorker;
    try {
      worker = createWorker();
    } catch {
      return null;
    }
    const bridge = createBridge(worker);
    const reply = await attachReply(bridge, sessionId, route);
    if (reply === 'unavailable') {
      bridge.terminate();
      return null;
    }
    if (reply === 'silent') {
      // Its read may still be waiting on the session, so the window cannot
      // read it now without being refused. Say so rather than guess.
      bridge.terminate();
      throw new Error('The network streaming worker did not answer. Connect again.');
    }
    return openedConnection(bridge, timeoutMs, acks);
  };
}

function openedConnection(
  bridge: Bridge,
  timeoutMs: number,
  acks: Parameters<HostedNetworkSessionOpener>[0]['acks'],
): SerialConnection {
  return createWorkerSerialConnection({
    bridge: {
      postMessage: (message, transfer) => {
        if (message.kind === 'attach' || message.kind === 'reattach-readable')
          throw new Error('Network sessions are read in their worker.');
        bridge.post(message, transfer);
      },
      onMessage: (handler) =>
        bridge.subscribe((message) => {
          if (isSerialWorkerResponse(message)) handler(message);
        }),
      onError: bridge.onError,
      terminate: bridge.terminate,
    },
    // The worker closes the session when it lets go of its writer.
    port: { readable: null, writable: null, close: async () => undefined },
    timeoutMs,
    start: () => bridge.post({ kind: 'network-start' }),
    acks,
  });
}

type Reply = (message: NetworkSerialWorkerResponse) => void;
type Bridge = ReturnType<typeof createBridge>;

function createBridge(worker: NetworkWorker) {
  const replies = new Set<Reply>();
  const errors = new Set<() => void>();
  let failed = false;
  let terminated = false;
  worker.onmessage = (event: MessageEvent<NetworkSerialWorkerResponse>) => {
    for (const reply of replies) reply(event.data);
  };
  const fail = (): void => {
    failed = true;
    for (const error of errors) error();
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  return {
    post: (request: NetworkSerialWorkerRequest, transfer: ReadonlyArray<unknown> = []): void => {
      if (failed || terminated) throw new Error('Network streaming worker is unavailable.');
      if (transfer.length === 0) worker.postMessage(request);
      else worker.postMessage(request, transfer as Transferable[]);
    },
    subscribe: (reply: Reply): (() => void) => {
      replies.add(reply);
      return () => replies.delete(reply);
    },
    onError: (error: () => void): (() => void) => {
      errors.add(error);
      if (failed) error();
      return () => errors.delete(error);
    },
    terminate: (): void => {
      if (terminated) return;
      terminated = true;
      worker.terminate();
      replies.clear();
      errors.clear();
    },
  };
}

/** 'ready', 'unavailable' when the worker could not read the session (or
 * never started), or 'silent' when it did not answer in time. */
function attachReply(
  bridge: Bridge,
  sessionId: string,
  route: Parameters<HostedNetworkSessionOpener>[0]['route'],
): Promise<'ready' | 'unavailable' | 'silent'> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = (): void => undefined;
    let unsubscribeError = (): void => undefined;
    const finish = (result: 'ready' | 'unavailable' | 'silent'): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      unsubscribeError();
      resolve(result);
    };
    const timer = setTimeout(() => finish('silent'), ATTACH_TIMEOUT_MS);
    unsubscribe = bridge.subscribe((message) => {
      if (message.kind === 'network-ready' && message.id === 1) finish('ready');
      if (message.kind === 'network-unavailable' && message.id === 1) {
        console.warn(`Network streaming worker unavailable: ${message.reason}`);
        finish('unavailable');
      }
    });
    // A worker that failed to load never touched the session.
    unsubscribeError = bridge.onError(() => finish('unavailable'));
    if (settled) return;
    try {
      bridge.post({ kind: 'network-attach', id: 1, sessionId, route });
    } catch {
      finish('unavailable');
    }
  });
}

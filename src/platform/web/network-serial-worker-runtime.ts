// The worker side of a desktop network session (ADR-676). The main process
// owns the socket and long-polls reads for at most a second
// (electron/machine-network-session.ts); this worker makes those reads and the
// numbered writes itself, so the serial worker core's refill (ADR-334) runs
// here, away from the window's thread, exactly as on a worker-owned USB port.
//
// The session crosses only after the worker's first read succeeds. Until then
// nothing has been read from it, so a worker that cannot reach the route
// leaves the session to the window. After that the worker is its only reader
// and writer, and any failure closes the connection rather than handing it
// back (ADR-354 decision 3).
//
// Closing the socket does not stop a controller, and a request that failed
// between here and the main process says nothing about the socket. So a failed
// read waits, bounded, for the store's stop, and a failed write leaves the
// session open for it, as the window's route does (ADR-398 Amendments 6 and 7).

import { createSerialWorkerCore, type SerialWorkerCore } from './serial-worker-core';
import {
  NETWORK_ATTACH_READ_TIMEOUT_MS,
  type NetworkSerialWorkerRequest,
  type NetworkSerialWorkerResponse,
  type NetworkSessionRoute,
} from './network-serial-worker-protocol';

type RuntimeDeps = {
  readonly post: (message: NetworkSerialWorkerResponse) => void;
  readonly fetch: typeof fetch;
};

export type NetworkSerialWorkerRuntime = {
  readonly handle: (request: NetworkSerialWorkerRequest) => void;
  readonly close: () => Promise<void>;
};

type ReadResult = { readonly bytes: Uint8Array; readonly closed: boolean };

type SessionChannel = {
  readonly read: (timeoutMs: number) => Promise<ReadResult>;
  readonly write: (sequence: number, bytes: Uint8Array) => Promise<void>;
  readonly close: () => Promise<void>;
};

type Phase = 'idle' | 'attaching' | 'ready' | 'started' | 'closing' | 'closed';

type RuntimeState = {
  phase: Phase;
  channel: SessionChannel | null;
  firstRead: ReadResult | null;
  closing: Promise<void> | null;
  /** Ends the wait for the store's stop after a failed read. */
  endReadFailureWait: (() => void) | null;
};

const READ_TIMEOUT_MS = 5_000;
const WRITE_TIMEOUT_MS = 5_000;
// How long a failed read waits for the stop it lets the store write through the
// session; the same bound as the window's route. A plain timer: this thread does
// not stall with the window.
const READ_FAILURE_STOP_WAIT_MS = 3_000;
// The route accepts 1-65536 wire bytes per write (desktop-machine-network.ts).
const MAX_WRITE_BYTES = 64 * 1024;
const MAX_READ_PAYLOAD_CHARS = 700_000;
const MAX_RESPONSE_CHARS = 800_000;

export function createNetworkSerialWorkerRuntime(deps: RuntimeDeps): NetworkSerialWorkerRuntime {
  const state: RuntimeState = {
    phase: 'idle',
    channel: null,
    firstRead: null,
    closing: null,
    endReadFailureWait: null,
  };
  const core = createSerialWorkerCore({
    post: (message) => {
      // The core has let go of both streams; finish here, then say so.
      if (message.kind === 'closed' || message.kind === 'read-error') void close();
      else if (state.phase !== 'closed') deps.post(message);
    },
  });
  const close = (): Promise<void> => {
    state.closing ??= closeRuntime(state, core, deps);
    return state.closing;
  };
  return {
    handle: (request) => handleRequest(state, core, deps, close, request),
    close,
  };
}

function handleRequest(
  state: RuntimeState,
  core: SerialWorkerCore,
  deps: RuntimeDeps,
  close: () => Promise<void>,
  request: NetworkSerialWorkerRequest,
): void {
  if (request.kind === 'close') {
    void close();
  } else if (state.phase === 'closing' || state.phase === 'closed') {
    return;
  } else if (request.kind === 'network-attach') {
    if (state.phase === 'idle') void attach(state, deps, request);
  } else if (request.kind === 'network-start') {
    start(state, core, deps, close);
  } else if (request.kind === 'read-failure-settled') {
    state.endReadFailureWait?.();
  } else if (state.phase === 'started') {
    core.handle(request);
  } else if (request.kind === 'write') {
    deps.post({ kind: 'write-error', id: request.id, message: 'Network worker has not started.' });
  } else {
    void close();
  }
}

async function attach(
  state: RuntimeState,
  deps: RuntimeDeps,
  request: Extract<NetworkSerialWorkerRequest, { readonly kind: 'network-attach' }>,
): Promise<void> {
  state.phase = 'attaching';
  const channel = sessionChannel(deps.fetch, request.route, request.sessionId);
  try {
    const first = await channel.read(NETWORK_ATTACH_READ_TIMEOUT_MS);
    if (state.phase !== 'attaching') return;
    state.channel = channel;
    state.firstRead = first;
    state.phase = 'ready';
    deps.post({ kind: 'network-ready', id: request.id });
  } catch (error) {
    if (state.phase !== 'attaching') return;
    state.phase = 'closed';
    deps.post({ kind: 'network-unavailable', id: request.id, reason: describeError(error) });
  }
}

function start(
  state: RuntimeState,
  core: SerialWorkerCore,
  deps: RuntimeDeps,
  close: () => Promise<void>,
): void {
  if (state.phase === 'started') return;
  const channel = state.channel;
  const first = state.firstRead;
  if (state.phase !== 'ready' || channel === null || first === null) {
    void close();
    return;
  }
  state.phase = 'started';
  state.firstRead = null;
  try {
    const streams = sessionStreams(channel, first, {
      readFailed: () => waitForReadFailureStop(state, deps),
      writeFailed: core.replaceWriter,
    });
    core.handle({ kind: 'attach', ...streams });
  } catch {
    void close();
  }
}

// The core's reader waits on this read while its writer still takes the store's
// stop. A close of the session, or the bound, ends the wait.
function waitForReadFailureStop(state: RuntimeState, deps: RuntimeDeps): Promise<void> {
  return new Promise((resolve) => {
    if (state.phase !== 'started') {
      resolve();
      return;
    }
    const timer = setTimeout(() => state.endReadFailureWait?.(), READ_FAILURE_STOP_WAIT_MS);
    state.endReadFailureWait = () => {
      clearTimeout(timer);
      state.endReadFailureWait = null;
      resolve();
    };
    deps.post({ kind: 'read-failing' });
  });
}

async function closeRuntime(
  state: RuntimeState,
  core: SerialWorkerCore,
  deps: RuntimeDeps,
): Promise<void> {
  const owned = state.channel;
  state.phase = 'closing';
  state.endReadFailureWait?.();
  // Releasing the writer closes the session too; the second close is a
  // no-op on the main process and covers a session that never started.
  await core.close();
  await owned?.close();
  state.channel = null;
  state.firstRead = null;
  state.phase = 'closed';
  deps.post({ kind: 'closed' });
}

type SessionFailureHooks = {
  /** Awaited before a failed read ends the stream. */
  readonly readFailed: () => Promise<void>;
  /** Takes the fresh stream that replaces one a failed write left errored. */
  readonly writeFailed: (writable: WritableStream<Uint8Array>) => void;
};

/** The session as the byte streams the serial worker core reads and writes. */
function sessionStreams(
  channel: SessionChannel,
  first: ReadResult,
  hooks: SessionFailureHooks,
): {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
} {
  let pending: ReadResult | null = first;
  let cancelled = false;
  const nextRead = async (): Promise<ReadResult> => {
    if (pending !== null) return pending;
    try {
      return await channel.read(READ_TIMEOUT_MS);
    } catch (error) {
      await hooks.readFailed();
      throw error;
    }
  };
  const readable = new ReadableStream<Uint8Array>({
    // A pull that enqueues nothing is not called again, so keep reading until
    // bytes arrive or the session ends. Each read waits up to a second.
    pull: async (controller) => {
      for (;;) {
        const result = await nextRead();
        pending = null;
        if (cancelled) return;
        if (result.bytes.byteLength > 0) controller.enqueue(result.bytes);
        if (result.closed) {
          controller.close();
          return;
        }
        if (result.bytes.byteLength > 0) return;
      }
    },
    cancel: () => {
      cancelled = true;
    },
  });
  return { readable, writable: sessionWritable(channel, hooks) };
}

// Delivery of a failed write is uncertain, so it is never retried, and the
// errored stream rejects whatever was queued behind it: a job line must not
// follow one that may be lost. Writes issued after the failure go out on a fresh
// stream, numbered after it, so a stop can still reach the controller. The main
// process closes a session whose write it refused, and the next read reports that.
function sessionWritable(
  channel: SessionChannel,
  hooks: SessionFailureHooks,
): WritableStream<Uint8Array> {
  let sequence = 0;
  const open = (): WritableStream<Uint8Array> =>
    new WritableStream<Uint8Array>({
      write: async (bytes) => {
        try {
          for (let offset = 0; offset < bytes.byteLength; offset += MAX_WRITE_BYTES) {
            sequence += 1;
            await channel.write(sequence, bytes.subarray(offset, offset + MAX_WRITE_BYTES));
          }
        } catch (error) {
          hooks.writeFailed(open());
          throw error;
        }
      },
      close: () => channel.close(),
      abort: () => channel.close(),
    });
  return open();
}

function sessionChannel(
  fetcher: typeof fetch,
  route: NetworkSessionRoute,
  sessionId: string,
): SessionChannel {
  const post = routePost(fetcher, route);
  return {
    read: async (timeoutMs) => {
      const result = await post('read', { sessionId }, timeoutMs);
      const payload = result['data'];
      if (typeof payload !== 'string' || payload.length > MAX_READ_PAYLOAD_CHARS)
        throw new Error('Invalid network read response.');
      const closed = result['closed'] === true;
      const reason = result['error'];
      if (closed && typeof reason === 'string')
        console.warn(`Network controller session: ${reason}`);
      return { bytes: decodeBase64(payload), closed };
    },
    write: async (sequence, bytes) => {
      await post('write', { sessionId, sequence, data: encodeBase64(bytes) }, WRITE_TIMEOUT_MS);
    },
    close: () =>
      post('close', { sessionId }, WRITE_TIMEOUT_MS).then(
        () => undefined,
        () => undefined,
      ),
  };
}

// The same request the window's transport makes (desktop-machine-network-api.ts).
function routePost(
  fetcher: typeof fetch,
  route: NetworkSessionRoute,
): (
  action: string,
  body: Record<string, unknown>,
  timeoutMs: number,
) => Promise<Record<string, unknown>> {
  return async (action, body, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`${route.url}${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [route.header]: '1' },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARS)
        throw new Error('Network response exceeds its local limit.');
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('Invalid network response.');
      const record = parsed as Record<string, unknown>;
      if (!response.ok)
        throw new Error(
          typeof record['error'] === 'string' ? record['error'] : 'Desktop network request failed.',
        );
      return record;
    } finally {
      clearTimeout(timer);
    }
  };
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

function decodeBase64(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

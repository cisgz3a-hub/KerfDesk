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
};

const READ_TIMEOUT_MS = 5_000;
const WRITE_TIMEOUT_MS = 5_000;
// The route accepts 1-65536 wire bytes per write (desktop-machine-network.ts).
const MAX_WRITE_BYTES = 64 * 1024;
const MAX_READ_PAYLOAD_CHARS = 700_000;
const MAX_RESPONSE_CHARS = 800_000;

export function createNetworkSerialWorkerRuntime(deps: RuntimeDeps): NetworkSerialWorkerRuntime {
  const state: RuntimeState = { phase: 'idle', channel: null, firstRead: null, closing: null };
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
    start(state, core, close);
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

function start(state: RuntimeState, core: SerialWorkerCore, close: () => Promise<void>): void {
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
    core.handle({ kind: 'attach', ...sessionStreams(channel, first, () => void close()) });
  } catch {
    void close();
  }
}

async function closeRuntime(
  state: RuntimeState,
  core: SerialWorkerCore,
  deps: RuntimeDeps,
): Promise<void> {
  const owned = state.channel;
  state.phase = 'closing';
  // Releasing the writer closes the session too; the second close is a
  // no-op on the main process and covers a session that never started.
  await core.close();
  await owned?.close();
  state.channel = null;
  state.firstRead = null;
  state.phase = 'closed';
  deps.post({ kind: 'closed' });
}

/** The session as the byte streams the serial worker core reads and writes. */
function sessionStreams(
  channel: SessionChannel,
  first: ReadResult,
  failed: () => void,
): {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
} {
  let pending: ReadResult | null = first;
  let cancelled = false;
  let sequence = 0;
  const readable = new ReadableStream<Uint8Array>({
    // A pull that enqueues nothing is not called again, so keep reading until
    // bytes arrive or the session ends. Each read waits up to a second.
    pull: async (controller) => {
      for (;;) {
        const result = pending ?? (await channel.read(READ_TIMEOUT_MS));
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
  const writable = new WritableStream<Uint8Array>({
    write: async (bytes) => {
      try {
        for (let offset = 0; offset < bytes.byteLength; offset += MAX_WRITE_BYTES) {
          sequence += 1;
          await channel.write(sequence, bytes.subarray(offset, offset + MAX_WRITE_BYTES));
        }
      } catch (error) {
        // The main process closes a session whose write it refused, so this
        // one closes too.
        failed();
        throw error;
      }
    },
    close: () => channel.close(),
    abort: () => channel.close(),
  });
  return { readable, writable };
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

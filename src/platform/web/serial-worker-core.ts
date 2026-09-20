// The serial worker's logic, separated from its `self.onmessage` shell so it
// can be driven with real streams in a test rather than only inside a Worker
// (ADR-334).
//
// What it owns: the read loop, and — only while armed — the character-counting
// refill. A refill goes out before the line that triggered it is forwarded,
// because that write is the one thing the machine is waiting on. Everything
// else about the line happens on the main thread afterwards, where a slow
// render or a compile can no longer delay the wire.
//
// What it does NOT own: any judgement. It never decides that a job is over,
// that an error is fatal, that a pause is safe, or what a status report means.
// Those stay on the main thread, which sees every line unchanged and in order.

import type { StreamerState } from '../../core/controllers/grbl';
// Deep import: the grbl barrel is at its public-export ratchet.
import { pumpInboundLine } from '../../core/controllers/grbl/stream-pump';
import { encodeWireBytes, extractSerialLines } from './serial-wire';
import type { SerialWorkerRequest, SerialWorkerResponse } from './serial-worker-protocol';

export type SerialWorkerCoreDeps = {
  readonly post: (message: SerialWorkerResponse) => void;
};

export type SerialWorkerCore = {
  readonly handle: (request: SerialWorkerRequest) => void;
  /** The stream position this worker currently refills, for assertions. */
  readonly armedStreamer: () => StreamerState | null;
  /** Resolves once the read loop has ended, for assertions. */
  readonly readLoop: () => Promise<void> | null;
};

type WorkerState = {
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  streamer: StreamerState | null;
  loop: Promise<void> | null;
};

export function createSerialWorkerCore(deps: SerialWorkerCoreDeps): SerialWorkerCore {
  const state: WorkerState = { reader: null, writer: null, streamer: null, loop: null };
  return {
    handle: (request) => handleRequest(state, deps, request),
    armedStreamer: () => state.streamer,
    readLoop: () => state.loop,
  };
}

function handleRequest(
  state: WorkerState,
  deps: SerialWorkerCoreDeps,
  request: SerialWorkerRequest,
): void {
  switch (request.kind) {
    case 'attach':
      state.reader = request.readable.getReader();
      state.writer = request.writable.getWriter();
      state.loop = runReadLoop(state, deps);
      return;
    case 'write':
      void writeBytes(state, request.data).then(
        () => deps.post({ kind: 'write-ack', id: request.id }),
        (error: unknown) =>
          deps.post({ kind: 'write-error', id: request.id, message: describeError(error) }),
      );
      return;
    case 'arm':
      // No catch-up step here: the main thread wrote whatever was due at the
      // position it is handing over, and writes on until `armed`.
      state.streamer = request.streamer;
      deps.post({ kind: 'armed' });
      return;
    case 'release':
      state.streamer = null;
      deps.post({ kind: 'released' });
      return;
    case 'close':
      void releaseStreams(state);
      return;
  }
}

async function writeBytes(state: WorkerState, data: string): Promise<void> {
  if (state.writer === null) throw new Error('Serial port not writable.');
  await state.writer.write(encodeWireBytes(data));
}

function handleLine(state: WorkerState, deps: SerialWorkerCoreDeps, line: string): void {
  if (state.streamer !== null) {
    const pumped = pumpInboundLine(state.streamer, line);
    state.streamer = pumped.streamer;
    if (pumped.toSend !== '') {
      void writeBytes(state, pumped.toSend).catch((error: unknown) => {
        // The main thread owns containment: it holds the safety notice, the
        // quarantine and the fail-dark path.
        deps.post({ kind: 'stream-write-error', message: describeError(error) });
      });
    }
  }
  deps.post({ kind: 'line', line });
}

async function runReadLoop(state: WorkerState, deps: SerialWorkerCoreDeps): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const reader = state.reader;
      if (reader === null) break;
      const { value, done } = await reader.read();
      if (done) break;
      const extracted = extractSerialLines(buffer, decoder.decode(value, { stream: true }));
      buffer = extracted.buffer;
      for (const line of extracted.lines) handleLine(state, deps, line);
    }
  } catch {
    // A yanked cable and a cancelled reader end the loop the same way; the
    // main thread decides what a closed port means.
  }
  deps.post({ kind: 'closed' });
}

// Mirrors the main-thread teardown: the reader and writer locks must be
// released before the owner can close the port.
async function releaseStreams(state: WorkerState): Promise<void> {
  const reader = state.reader;
  const writer = state.writer;
  state.streamer = null;
  state.reader = null;
  state.writer = null;
  if (reader !== null) {
    await reader.cancel().catch(() => undefined);
    releaseLock(() => reader.releaseLock());
  }
  if (writer !== null) {
    await writer.abort().catch(() => undefined);
    releaseLock(() => writer.releaseLock());
  }
}

function releaseLock(release: () => void): void {
  try {
    release();
  } catch {
    // already released
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
import { classifyResponse } from '../../core/controllers/grbl/response';
import { detectControllerFromBanner } from '../../core/controllers/detect-controller';
import { RT_SOFT_RESET } from '../../core/controllers/grbl/commands';
import { EMPTY_SERIAL_LINE_STATE, encodeWireBytes, extractSerialLines } from './serial-wire';
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
  barrier: Promise<void> | null;
  resume: (() => void) | null;
  armId: number | null;
  closed: boolean;
};

export function createSerialWorkerCore(deps: SerialWorkerCoreDeps): SerialWorkerCore {
  const state: WorkerState = {
    reader: null,
    writer: null,
    streamer: null,
    loop: null,
    barrier: null,
    resume: null,
    armId: null,
    closed: false,
  };
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
  if (state.closed) return;
  switch (request.kind) {
    case 'attach':
      state.reader = request.readable.getReader();
      state.writer = request.writable.getWriter();
      state.loop = runReadLoop(state, deps);
      return;
    case 'write':
      // Disconnect and write-failure containment can reset without waiting
      // for release. A reset invalidates this queue before its banner arrives.
      if (request.data.includes(RT_SOFT_RESET) && state.streamer !== null) {
        state.streamer = null;
        deps.post({ kind: 'refill-stopped' });
      }
      void writeBytes(state, request.data).then(
        () => deps.post({ kind: 'write-ack', id: request.id }),
        (error: unknown) =>
          deps.post({ kind: 'write-error', id: request.id, message: describeError(error) }),
      );
      return;
    case 'prepare-arm':
      state.armId = request.id;
      state.barrier = new Promise<void>((resolve) => {
        state.resume = resolve;
      });
      deps.post({ kind: 'ready', id: request.id });
      return;
    case 'arm':
      if (state.armId !== request.id) return;
      state.streamer = request.streamer;
      deps.post({ kind: 'armed', id: request.id });
      resumeLines(state);
      return;
    case 'release':
      state.streamer = null;
      deps.post({ kind: 'released', id: request.id });
      resumeLines(state);
      return;
    case 'close':
      void releaseStreams(state);
      return;
  }
}

function resumeLines(state: WorkerState): void {
  const resume = state.resume;
  state.armId = null;
  state.barrier = null;
  state.resume = null;
  resume?.();
}

async function writeBytes(state: WorkerState, data: string): Promise<void> {
  if (state.writer === null) throw new Error('Serial port not writable.');
  await state.writer.write(encodeWireBytes(data));
}

function handleLine(state: WorkerState, deps: SerialWorkerCoreDeps, line: string): void {
  const invalidated = state.streamer !== null && invalidatesRefill(line);
  if (invalidated) state.streamer = null;
  if (state.streamer !== null) {
    const pumped = pumpInboundLine(state.streamer, line);
    state.streamer = pumped.streamer;
    if (pumped.toSend !== '') {
      void writeBytes(state, pumped.toSend).catch((error: unknown) => {
        // The main thread owns containment: it holds the safety notice, the
        // quarantine and the fail-dark path.
        state.streamer = null;
        deps.post({ kind: 'stream-write-error', message: describeError(error) });
        deps.post({ kind: 'refill-stopped' });
      });
    }
  }
  deps.post({ kind: 'line', line });
  // The renderer must process the invalidating line before taking ownership
  // back. Later acknowledgements, even in this same chunk, cannot refill here.
  if (invalidated) deps.post({ kind: 'refill-stopped' });
}

function invalidatesRefill(line: string): boolean {
  const response = classifyResponse(line);
  if (response.kind === 'status') {
    return (
      response.report.mpgActive === true ||
      response.report.state === 'Alarm' ||
      response.report.state === 'Sleep'
    );
  }
  return (
    (response.kind === 'welcome' || response.kind === 'unknown') &&
    detectControllerFromBanner(response.raw) !== null
  );
}

async function runReadLoop(state: WorkerState, deps: SerialWorkerCoreDeps): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  let framing = EMPTY_SERIAL_LINE_STATE;
  try {
    for (;;) {
      const reader = state.reader;
      if (reader === null) break;
      const { value, done } = await reader.read();
      if (done) break;
      const extracted = extractSerialLines(framing, decoder.decode(value, { stream: true }));
      framing = extracted.state;
      for (const line of extracted.lines) {
        if (state.barrier !== null) await state.barrier;
        if (state.closed) break;
        handleLine(state, deps, line);
      }
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
  state.closed = true;
  state.streamer = null;
  resumeLines(state);
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

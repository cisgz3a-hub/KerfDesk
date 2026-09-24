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
// The one transport fact it reports is how its read stream ended: a line error
// that left the port open (`read-error`), or an end it cannot read past
// (`closed`, after letting go of both streams).

import type { StreamerState } from '../../core/controllers/grbl';
// Deep import: the grbl barrel is at its public-export ratchet.
import { pumpInboundLine } from '../../core/controllers/grbl/stream-pump';
import { classifyResponse } from '../../core/controllers/grbl/response';
import { detectControllerFromBanner } from '../../core/controllers/detect-controller';
import { RT_SOFT_RESET } from '../../core/controllers/grbl/commands';
import { closeWriterBounded } from './bounded-writer-close';
import {
  createReadRecoveryBudget,
  recoverableReadErrorName,
  type ReadRecoveryBudget,
} from './serial-read-recovery';
import { EMPTY_SERIAL_LINE_STATE, encodeWireBytes, extractSerialLines } from './serial-wire';
import type { SerialWorkerRequest, SerialWorkerResponse } from './serial-worker-protocol';

export type SerialWorkerCoreDeps = {
  readonly post: (message: SerialWorkerResponse) => void;
  /** Notify an owning native transport before potentially stalled cleanup. */
  readonly onClosing?: () => void;
};

export type SerialWorkerCore = {
  readonly handle: (request: SerialWorkerRequest) => void;
  /** The stream position this worker currently refills, for assertions. */
  readonly armedStreamer: () => StreamerState | null;
  /** Resolves once the current read loop has ended, for assertions. */
  readonly readLoop: () => Promise<void> | null;
  /** Releases both stream locks before reporting the transport closed. */
  readonly close: () => Promise<void>;
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
  closing: Promise<void> | null;
  release: Promise<void> | null;
  closedPosted: boolean;
  readonly recovery: ReadRecoveryBudget;
};

type ReadFailure = { readonly error: unknown };

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
    closing: null,
    release: null,
    closedPosted: false,
    recovery: createReadRecoveryBudget(),
  };
  return {
    handle: (request) => {
      if (state.closed) handleAfterClose(request);
      else handleRequest(state, deps, request);
    },
    armedStreamer: () => state.streamer,
    readLoop: () => state.loop,
    close: () => closeCore(state, deps, state.loop),
  };
}

// A replacement readable that crossed with Close must still be let go: the
// port's own stream stays locked by the transfer pipe until this end cancels.
function handleAfterClose(request: SerialWorkerRequest): void {
  if (request.kind === 'reattach-readable') void request.readable.cancel().catch(() => undefined);
}

function handleRequest(
  state: WorkerState,
  deps: SerialWorkerCoreDeps,
  request: SerialWorkerRequest,
): void {
  switch (request.kind) {
    case 'attach':
      state.writer = request.writable.getWriter();
      startReading(state, deps, request.readable);
      return;
    case 'reattach-readable':
      startReading(state, deps, request.readable);
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
      void closeCore(state, deps, state.loop);
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

function startReading(
  state: WorkerState,
  deps: SerialWorkerCoreDeps,
  readable: ReadableStream<Uint8Array>,
): void {
  const reader = readable.getReader();
  state.reader = reader;
  state.loop = runReadLoop(state, deps, reader);
}

async function runReadLoop(
  state: WorkerState,
  deps: SerialWorkerCoreDeps,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  const failure = await forwardLines(state, deps, reader);
  // A requested close reports itself once both streams are released.
  if (state.closed) return;
  const lineError = failure === null ? null : recoverableReadErrorName(failure.error);
  if (lineError !== null && state.recovery.admit()) {
    // The port is still open, with a fresh readable only its owner can reach:
    // the main thread for transferred streams, the native runtime for its own
    // port (ADR-354). Keep the writer and any armed refill, and ask for it.
    releaseLock(() => reader.releaseLock());
    state.reader = null;
    deps.post({ kind: 'read-error', name: lineError });
    return;
  }
  // The read side ended by itself: the device went away, or a read failed for
  // good. Let go of both streams BEFORE reporting it. Posting 'closed' while
  // still holding the transferred writer kept the port's own writable locked,
  // so port.close() failed and the next Connect to the same port threw "The
  // port is already open" until a page reload (audit transport-3). This
  // loop is the one ending, so the close does not wait for it.
  await closeCore(state, deps, null);
}

// Resolves null when the stream ended (a cancel, or a close while lines were
// held at a barrier), or the error that ended it.
async function forwardLines(
  state: WorkerState,
  deps: SerialWorkerCoreDeps,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadFailure | null> {
  // Framing lives and dies with one reader: after a line error the partial
  // record is missing bytes, so the next stream starts a fresh one rather than
  // gluing the two halves into a plausible but wrong line.
  const decoder = new TextDecoder('utf-8');
  let framing = EMPTY_SERIAL_LINE_STATE;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      if (value.byteLength > 0) state.recovery.received();
      const extracted = extractSerialLines(framing, decoder.decode(value, { stream: true }));
      framing = extracted.state;
      for (const line of extracted.lines) {
        if (state.barrier !== null) await state.barrier;
        if (state.closed) return null;
        handleLine(state, deps, line);
      }
    }
  } catch (error) {
    return { error };
  }
}

// One close, whoever starts it: the owner's close(), a 'close' request, or a
// read side that ended by itself. Lines and refill stop at once; every caller
// shares one promise, installed before the owner is told or any stream is
// cancelled, since a native owner may call close again while it reacts
// (ADR-354).
function closeCore(
  state: WorkerState,
  deps: SerialWorkerCoreDeps,
  loop: Promise<void> | null,
): Promise<void> {
  if (state.closing !== null) return state.closing;
  state.closed = true;
  state.streamer = null;
  resumeLines(state);
  state.closing = Promise.resolve()
    .then(() => releaseOnce(state))
    // The cancelled read ends the loop promptly; no line may follow 'closed'.
    .then(() => loop)
    .then(() => postClosed(state, deps));
  deps.onClosing?.();
  return state.closing;
}

function releaseOnce(state: WorkerState): Promise<void> {
  state.release ??= releaseStreams(state);
  return state.release;
}

function postClosed(state: WorkerState, deps: SerialWorkerCoreDeps): void {
  if (state.closedPosted) return;
  state.closedPosted = true;
  deps.post({ kind: 'closed' });
}

// Mirrors the main-thread teardown: the reader and writer locks must be
// released before the owner can close the port.
async function releaseStreams(state: WorkerState): Promise<void> {
  const reader = state.reader;
  const writer = state.writer;
  state.reader = null;
  state.writer = null;
  if (reader !== null) {
    await reader.cancel().catch(() => undefined);
    releaseLock(() => reader.releaseLock());
  }
  if (writer !== null) {
    // Close, not abort (audit transport-4). abort() discards every queued
    // byte (Chromium's sink flushes the transmit buffer), and a Disconnect
    // has just queued the driver's M5/M9 cleanup lines. On a transferred
    // writable close() settles as soon as the close is posted, so the
    // renderer waits for the port's own writable to finish draining before
    // it closes the port. The bounded close still aborts a local sink that
    // cannot drain, so a wedged one cannot hang this.
    await closeWriterBounded(writer);
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

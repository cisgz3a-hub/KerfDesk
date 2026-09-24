// Messages between the renderer and the serial worker (ADR-334).
//
// The worker owns the byte pipe and, while armed, the character-counting
// refill. It forwards EVERY inbound line unchanged, so nothing on the main
// thread — the acknowledgement ledger, the safety handlers, the console —
// changes behaviour or ordering because of where the bytes were read.
//
// prepare-arm pauses line delivery. The renderer drains all lines preceding
// ready, captures its current state, and suppresses its own refill before
// sending arm. The worker adopts that state before resuming line delivery.

import type { StreamerState } from '../../core/controllers/grbl';

export type SerialWorkerRequest =
  /** Hand over the opened port's duplex streams. Both are transferred. */
  | {
      readonly kind: 'attach';
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array>;
    }
  /** The port's fresh readable after a recoverable line error (`read-error`).
   *  Transferred; the worker reads on with the writer and refill it kept. */
  | { readonly kind: 'reattach-readable'; readonly readable: ReadableStream<Uint8Array> }
  /** A write the main thread owns (console, jog, poll, cleanup). Acknowledged
   * so `SerialConnection.write` keeps resolving after the bytes are queued,
   * which the transport ledger and the write-epoch assertions depend on. */
  | { readonly kind: 'write'; readonly id: number; readonly data: string }
  /** Stop forwarding lines and establish a snapshot barrier. */
  | { readonly kind: 'prepare-arm'; readonly id: number }
  /** Adopt the position captured at the matching ready barrier. */
  | { readonly kind: 'arm'; readonly id: number; readonly streamer: StreamerState }
  /** Give the refill back to the main thread (pause, resume, tool change,
   * abort, or any other status change it owns). */
  | { readonly kind: 'release'; readonly id: number }
  /** Release the stream locks so the main thread can close the port. */
  | { readonly kind: 'close' };

export type SerialWorkerResponse =
  /** One inbound line, in wire order. */
  | { readonly kind: 'line'; readonly line: string }
  /** All lines before this snapshot barrier have already been forwarded. */
  | { readonly kind: 'ready'; readonly id: number }
  | { readonly kind: 'armed'; readonly id: number }
  | { readonly kind: 'released'; readonly id: number }
  /** Controller reset/takeover or write failure stopped autonomous refill. */
  | { readonly kind: 'refill-stopped' }
  | { readonly kind: 'write-ack'; readonly id: number }
  | { readonly kind: 'write-error'; readonly id: number; readonly message: string }
  /** A refill write failed. The main thread owns the containment. */
  | { readonly kind: 'stream-write-error'; readonly message: string }
  /** A UART line error (FramingError, ParityError, BreakError,
   *  BufferOverrunError) ended the read stream but left the port open. Only
   *  the main thread can reach `port.readable`; the worker waits for
   *  `reattach-readable`, still holding the writer (audit connect-1). */
  | { readonly kind: 'read-error'; readonly name: string }
  /** The session is over: the device dropped, a read failed for good, or
   *  `close` was honoured. Either way the worker has already let go of both
   *  streams, so the port can be closed once they finish (audit transport-3). */
  | { readonly kind: 'closed' };

export function isSerialWorkerResponse(value: unknown): value is SerialWorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { readonly kind?: unknown }).kind;
  return (
    kind === 'line' ||
    kind === 'ready' ||
    kind === 'armed' ||
    kind === 'released' ||
    kind === 'refill-stopped' ||
    kind === 'write-ack' ||
    kind === 'write-error' ||
    kind === 'stream-write-error' ||
    kind === 'read-error' ||
    kind === 'closed'
  );
}

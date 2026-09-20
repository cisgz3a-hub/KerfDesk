// Messages between the renderer and the serial worker (ADR-334).
//
// The worker owns the byte pipe and, while armed, the character-counting
// refill. It forwards EVERY inbound line unchanged, so nothing on the main
// thread — the acknowledgement ledger, the safety handlers, the console —
// changes behaviour or ordering because of where the bytes were read.
//
// The streamer state travels as a structured clone at arm time. It is a plain
// immutable record (queued lines, queue index, in-flight list and byte tally,
// counters, window size), so the worker adopts the exact position the main
// thread is in and both then evolve identically from the same line sequence.

import type { StreamerState } from '../../core/controllers/grbl';

export type SerialWorkerRequest =
  /** Hand over the opened port's duplex streams. Both are transferred. */
  | {
      readonly kind: 'attach';
      readonly readable: ReadableStream<Uint8Array>;
      readonly writable: WritableStream<Uint8Array>;
    }
  /** A write the main thread owns (console, jog, poll, cleanup). Acknowledged
   * so `SerialConnection.write` keeps resolving after the bytes are queued,
   * which the transport ledger and the write-epoch assertions depend on. */
  | { readonly kind: 'write'; readonly id: number; readonly data: string }
  /** Take over the refill for this stream position. */
  | { readonly kind: 'arm'; readonly streamer: StreamerState }
  /** Give the refill back to the main thread (pause, resume, tool change,
   * abort, or any other status change it owns). */
  | { readonly kind: 'release' }
  /** Release the stream locks so the main thread can close the port. */
  | { readonly kind: 'close' };

export type SerialWorkerResponse =
  /** One inbound line, in wire order. */
  | { readonly kind: 'line'; readonly line: string }
  /** The refill handover is complete. Ownership changes only on these two, and
   * message order is preserved, so exactly one side writes refills at any
   * moment: the main thread keeps writing until `armed` arrives, and keeps
   * deferring until `released` does. */
  | { readonly kind: 'armed' }
  | { readonly kind: 'released' }
  | { readonly kind: 'write-ack'; readonly id: number }
  | { readonly kind: 'write-error'; readonly id: number; readonly message: string }
  /** A refill write failed. The main thread owns the containment. */
  | { readonly kind: 'stream-write-error'; readonly message: string }
  /** The read loop ended: the device dropped, or `close` was honoured. */
  | { readonly kind: 'closed' };

export function isSerialWorkerResponse(value: unknown): value is SerialWorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { readonly kind?: unknown }).kind;
  return (
    kind === 'line' ||
    kind === 'armed' ||
    kind === 'released' ||
    kind === 'write-ack' ||
    kind === 'write-error' ||
    kind === 'stream-write-error' ||
    kind === 'closed'
  );
}

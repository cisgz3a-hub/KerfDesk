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
  /** The read loop ended: the device dropped, or `close` was honoured. */
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
    kind === 'closed'
  );
}

// grbl-sim-rx-window — models GRBL's hardware serial receive ring: the bytes a
// host has written that the firmware's main loop has not yet consumed.
//
// Firmware ground truth (gnea/grbl 1.1h, bfb67f0c):
//  * `grbl/serial.h`: `#define RX_BUFFER_SIZE 128`; `grbl/serial.c:24`
//    allocates the ring as `RX_RING_BUFFER (RX_BUFFER_SIZE+1)` and keeps one
//    slot empty to tell full from empty, so all 128 bytes are usable. (grbl's
//    own `doc/script/stream.py` stays below `RX_BUFFER_SIZE - 1`, a
//    conservative host, not the firmware's limit.)
//  * `grbl/serial.c` `ISR(SERIAL_RX)` executes realtime bytes (`?`, `!`, `~`,
//    0x18 and every byte above 0x7F) inside the interrupt and never stores
//    them, so they occupy no ring space. Every other byte is written "unless
//    it is full" — when full the byte is dropped with no error, no
//    notification, and no recovery.
//  * `grbl/protocol.c:79` ends a line at `\n` OR `\r`, so each one is an end
//    of line (`G21\r\n` is `G21` plus an empty line, each answered `ok`).
//    grblHAL treats a CRLF or LFCR pair as one end of line (protocol.c:227-233).
//  * grblHAL sizes the same ring at 1024 (`grblHAL/core/stream.h`).
//
// Line terminators are ordinary bytes here: `\r` and `\n` occupy ring space,
// which is why a character-counting sender has to count them too.
//
// `droppedBytes` is the assertion surface this module exists for. A dropped
// byte silently corrupts the line stream — the precise failure a
// character-counting sender exists to prevent, and the one no test in this repo
// could reach while the simulator acked instantly.

/** `RX_BUFFER_SIZE` on stock grbl 1.1. */
export const GRBL_RX_BUFFER_BYTES = 128;

/** Usable bytes: the ring is one byte larger than `RX_BUFFER_SIZE`, and that
 * spare slot is the one kept empty (serial.c:24, :37-42). */
export const GRBL_RX_USABLE_BYTES = GRBL_RX_BUFFER_BYTES;

/** Ring size on grblHAL (`grblHAL/core/stream.h`), for capability-delta tests. */
export const GRBLHAL_RX_BUFFER_BYTES = 1024;

export type GrblSimRxWindow = {
  /** Usable byte capacity. Bytes arriving beyond this are dropped, as on hardware. */
  readonly capacity: number;
  /** Raw bytes received but not yet consumed by the main loop. */
  readonly pending: string;
  /** High-water mark of `pending`, across the window's whole life. */
  readonly peakBytes: number;
  /** Bytes the ring silently discarded. Any value above zero is a sender bug. */
  readonly droppedBytes: number;
  /** grblHAL only: the end-of-line byte that closed the previous line, so the
   * other half of a CRLF or LFCR pair does not read as an empty line. */
  readonly lastEol?: string | null;
};

/** Stock GRBL: every `\r` and every `\n` ends a line. grblHAL: a CRLF or LFCR
 * pair ends one line. */
export type GrblSimLineEnding = 'each' | 'pair';

export function createRxWindow(capacity: number = GRBL_RX_USABLE_BYTES): GrblSimRxWindow {
  return { capacity, pending: '', peakBytes: 0, droppedBytes: 0 };
}

/**
 * Deliver host bytes into the ring. Bytes that do not fit are dropped exactly
 * as the AVR ISR drops them: silently, with no error to the host.
 */
export function acceptRxBytes(window: GrblSimRxWindow, data: string): GrblSimRxWindow {
  if (data === '') return window;
  const headroom = Math.max(0, window.capacity - window.pending.length);
  const stored = data.slice(0, headroom);
  const dropped = data.length - stored.length;
  const pending = window.pending + stored;
  return {
    ...window,
    pending,
    peakBytes: Math.max(window.peakBytes, pending.length),
    droppedBytes: window.droppedBytes + dropped,
  };
}

/**
 * Consume one complete line from the ring, freeing its bytes — the main loop's
 * read step. Returns `line: null` when no terminator has arrived yet, which is
 * how a partially-received line correctly keeps occupying ring space.
 */
export function takeRxLine(
  window: GrblSimRxWindow,
  lineEnding: GrblSimLineEnding = 'each',
): {
  readonly window: GrblSimRxWindow;
  readonly line: string | null;
} {
  let pending = window.pending;
  let lastEol = window.lastEol ?? null;
  for (;;) {
    const terminator = pending.search(/[\r\n]/);
    if (terminator === -1) return { window: { ...window, pending, lastEol }, line: null };
    const eol = pending.charAt(terminator);
    const raw = pending.slice(0, terminator);
    pending = pending.slice(terminator + 1);
    const pairTail = lineEnding === 'pair' && raw === '' && lastEol !== null && lastEol !== eol;
    lastEol = pairTail ? null : eol;
    if (!pairTail) return { window: { ...window, pending, lastEol }, line: raw.trim() };
  }
}

/** Bytes currently occupied. The value a sender's in-flight tally must not exceed. */
export function rxBytesInUse(window: GrblSimRxWindow): number {
  return window.pending.length;
}

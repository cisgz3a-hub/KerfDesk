// grbl-sim-rx-window — models GRBL's hardware serial receive ring: the bytes a
// host has written that the firmware's main loop has not yet consumed.
//
// Firmware ground truth, read from gnea/grbl v1.1 source on 2026-07-27:
//  * `grbl/serial.h`: `#define RX_BUFFER_SIZE 128`.
//  * `grbl/serial.c` `ISR(SERIAL_RX)` executes realtime bytes (?, !, ~, 0x18,
//    0x84, 0x85) inside the interrupt and never stores them, so they occupy no
//    ring space. Every other byte is written "unless it is full" — when full
//    the byte is dropped with no error, no notification, and no recovery.
//  * The ring reserves one slot: `serial_get_rx_buffer_available()` returns
//    `rtail - head - 1` on the wrapped branch, so 127 of the 128 bytes are
//    usable. grbl's own `doc/script/stream.py` streams against
//    `RX_BUFFER_SIZE - 1` for exactly that reason.
//  * grblHAL sizes the same ring at 1024 (`grblHAL/core/stream.h`).
//
// Line terminators are ordinary bytes here: `\r` and `\n` occupy ring space,
// which is why a character-counting sender has to count them too.
//
// `droppedBytes` is the assertion surface this module exists for. A dropped
// byte silently corrupts the line stream — the precise failure a
// character-counting sender exists to prevent, and the one no test in this repo
// could reach while the simulator acked instantly.

/** Physical ring size on stock grbl 1.1 (`RX_BUFFER_SIZE`). */
export const GRBL_RX_BUFFER_BYTES = 128;

/** Usable bytes: the ring reserves one slot to distinguish full from empty. */
export const GRBL_RX_USABLE_BYTES = GRBL_RX_BUFFER_BYTES - 1;

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
};

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
export function takeRxLine(window: GrblSimRxWindow): {
  readonly window: GrblSimRxWindow;
  readonly line: string | null;
} {
  const terminator = window.pending.indexOf('\n');
  if (terminator === -1) return { window, line: null };
  const raw = window.pending.slice(0, terminator);
  return {
    window: { ...window, pending: window.pending.slice(terminator + 1) },
    line: raw.replace(/\r/g, '').trim(),
  };
}

/** Bytes currently occupied. The value a sender's in-flight tally must not exceed. */
export function rxBytesInUse(window: GrblSimRxWindow): number {
  return window.pending.length;
}

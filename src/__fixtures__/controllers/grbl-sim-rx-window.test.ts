// Tests the measuring instrument first (ADR-025 discipline). If the ring does
// not drop bytes exactly when hardware would, every streaming proof built on it
// is worthless.

import { describe, expect, it } from 'vitest';
import {
  acceptRxBytes,
  createRxWindow,
  GRBL_RX_BUFFER_BYTES,
  GRBL_RX_USABLE_BYTES,
  GRBLHAL_RX_BUFFER_BYTES,
  rxBytesInUse,
  takeRxLine,
} from './grbl-sim-rx-window';

describe('grbl-sim-rx-window', () => {
  it('pins the firmware buffer sizes read from grbl and grblHAL source', () => {
    expect(GRBL_RX_BUFFER_BYTES).toBe(128);
    expect(GRBL_RX_USABLE_BYTES).toBe(127);
    expect(GRBLHAL_RX_BUFFER_BYTES).toBe(1024);
  });

  it('accumulates bytes and tracks the high-water mark', () => {
    const window = acceptRxBytes(acceptRxBytes(createRxWindow(), 'G1 X1\n'), 'G1 X2\n');
    expect(rxBytesInUse(window)).toBe(12);
    expect(window.peakBytes).toBe(12);
    expect(window.droppedBytes).toBe(0);
  });

  it('silently drops the bytes that do not fit, as the AVR ISR does', () => {
    const window = acceptRxBytes(createRxWindow(8), 'G1 X100 Y200\n');
    expect(rxBytesInUse(window)).toBe(8);
    expect(window.droppedBytes).toBe(5);
    // The surviving prefix is what a real controller would then mis-parse.
    expect(window.pending).toBe('G1 X100 ');
  });

  it('counts line terminators against the ring, so a sender must count them too', () => {
    const window = acceptRxBytes(createRxWindow(6), 'G1X1\r\n');
    expect(window.droppedBytes).toBe(0);
    expect(rxBytesInUse(window)).toBe(6);
  });

  it('yields no line until a terminator arrives, and keeps holding the bytes', () => {
    const window = acceptRxBytes(createRxWindow(), 'G1 X1');
    const taken = takeRxLine(window);
    expect(taken.line).toBeNull();
    expect(rxBytesInUse(taken.window)).toBe(5);
  });

  it('frees exactly the consumed line, strips CR, and leaves the remainder queued', () => {
    const window = acceptRxBytes(createRxWindow(), 'G1 X1\r\nG1 X2\n');
    const first = takeRxLine(window);
    expect(first.line).toBe('G1 X1');
    expect(rxBytesInUse(first.window)).toBe(6);
    const second = takeRxLine(first.window);
    expect(second.line).toBe('G1 X2');
    expect(rxBytesInUse(second.window)).toBe(0);
  });

  it('wedges when the terminator itself is dropped — the real overrun failure', () => {
    // Overrun does not merely lose the tail: the '\n' is dropped too, so the
    // ring stays full of a truncated line the firmware can never complete.
    const filled = acceptRxBytes(createRxWindow(4), 'ABCDEF');
    const wedged = acceptRxBytes(filled, '\n');
    expect(wedged.droppedBytes).toBe(3);
    expect(wedged.peakBytes).toBe(4);
    expect(takeRxLine(wedged).line).toBeNull();
    expect(rxBytesInUse(wedged)).toBe(4);
  });
});

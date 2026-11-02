// Rolling audit v9 R1-P3-2: the model's quickstop held a handler on a one-shot
// wake-up. `Date.now()` reads the wall clock and timers the monotonic one, so
// the wake-up could land just short of the deadline, and nothing woke the model
// again: M410 and M5 I were never answered, and a thread test hung on the ledger.
// Firmware polls in idle(), so the model does too.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFifoMarlin } from './marlin-fifo-model';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the FIFO Marlin model after a quickstop', () => {
  it('answers the lines held by the cleaning window, though its wake-up lands short', async () => {
    const marlin = createFifoMarlin();
    const port = await marlin.adapter.serial.requestPort();
    const connection = await port?.open({ baudRate: 250_000 });
    const replies: string[] = [];
    connection?.onLine((line) => replies.push(line));

    await connection?.write('M410\nM5 I\n');
    await vi.advanceTimersByTimeAsync(10);
    // The two clocks disagree by a millisecond from here on.
    const clock = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => clock() - 1);
    await vi.advanceTimersByTimeAsync(1_100);

    expect(replies).toEqual(['ok', 'ok']);
    expect(marlin.state().ring).toEqual([]);
  });
});

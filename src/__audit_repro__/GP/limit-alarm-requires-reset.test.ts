// Audit repro GP-2 (GRBL 1.1 protocol core).
//
// Correct behaviour: a hard-limit (ALARM:1) or soft-limit (ALARM:2) alarm is a
// GRBL 1.1h "critical event". protocol_exec_rt_system prints `ALARM:N`, then
// `[MSG:Reset to continue]`, clears EXEC_RESET and spins in
// `do { } while (bit_isfalse(sys_rt_exec_state,EXEC_RESET));` — it parses no
// line (so `$X`/`$H` are never answered) and answers no `?` until the host
// sends Ctrl-X (0x18). The wiki: "`[MSG:Reset to continue]` - Critical event
// message. Reset is required before Grbl accepts any other commands."
// After that message the store must offer/perform the soft reset, not send a
// `$X` that GRBL cannot answer (and which then strands an owed acknowledgement
// that blocks Home/Jog/Frame until a reconnect).
//
// Upstream: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L219-L238
//           https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c (hard limit ISR: mc_reset + EXEC_ALARM_HARD_LIMIT; limits_soft_check: mc_reset + EXEC_ALARM_SOFT_LIMIT)
//           https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface ("[MSG:Reset to continue]")
//
// This test FAILS on current code: unlockAlarm() writes `$X\n` into the
// critical-event loop, times out after 8 s and leaves pendingUntrackedAcks = 1.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../../ui/state/laser-store';
import {
  connectWith,
  flushConnect,
  makeConnection,
} from '../../ui/state/laser-store-console.test-support';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

describe('GP-2: ALARM:1/2 + [MSG:Reset to continue] need Ctrl-X first', () => {
  it.each([1, 2])('does not send an unanswerable $X after ALARM:%i', async (code) => {
    const writes: string[] = [];
    // GRBL in the critical-event loop: nothing is answered until 0x18.
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine(`ALARM:${code}`);
    connection.emitLine('[MSG:Reset to continue]');
    await flushConnect();
    expect(useLaserStore.getState().alarmCode).toBe(code);
    writes.length = 0;

    vi.useFakeTimers();
    const unlock = useLaserStore
      .getState()
      .unlockAlarm()
      .then(
        () => 'resolved',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    await vi.advanceTimersByTimeAsync(8_100);
    const outcome = await unlock;

    const beforeReset = writes.slice(
      0,
      writes.indexOf('\x18') === -1 ? writes.length : writes.indexOf('\x18'),
    );
    // Correct: `$X` is never written into the critical-event loop.
    expect.soft(beforeReset).not.toContain('$X\n');
    // Correct: no acknowledgement is left owed for a line GRBL will never answer.
    expect.soft(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    // Evidence of the current behaviour for the report.
    expect(outcome).not.toMatch(/timed out/);
  });
});

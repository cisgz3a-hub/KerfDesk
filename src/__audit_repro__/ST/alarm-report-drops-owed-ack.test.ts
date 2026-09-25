// ST-3 repro — every `<Alarm|...>` status report wipes the owed-acknowledgement
// ledger and cancels the owned exchange in flight, although GRBL keeps
// answering every line it receives while it is in Alarm.
//
// Correct behaviour: an Alarm *status report* flushes nothing. GRBL 1.1h only
// discards its RX buffer on a reset (main.c:88 serial_reset_read_buffer() in
// the re-init loop). In Alarm the main loop still executes `$` system commands
// and answers G-code with error:9 (protocol.c:96-101). Status requests are
// served at the start of each line (protocol.c:81 protocol_execute_realtime()
// runs at the end-of-line check point before the line executes), so an
// `<Alarm|...>` report for a `?` that reached GRBL while `$X\n` was arriving is
// sent BEFORE that `$X` executes and prints `[MSG:Caution: Unlocked]` + `ok`:
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L79-L105
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c (case 'X')
// KerfDesk's handleInvalidatingStatus (laser-status-line.ts) runs on every
// Alarm report: it advances the write epoch, sets pendingUntrackedAcks to 0
// and calls cancelControllerLifecycleRefs('Controller entered Alarm.'), so the
// operator's Unlock is rejected although the controller unlocks, and the ok
// that follows is orphaned. (Home has a dedicated stale-Alarm window,
// laser-home-alarm-reply.ts; the Unlock exchange has none.)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../../ui/state/laser-store';
import {
  connectWith,
  flushConnect,
  makeConnection,
} from '../../ui/state/laser-store-console.test-support';

const ALARM = '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

describe('ST-3: an Alarm status report that precedes the $X it raced', () => {
  it('lets the Unlock settle on its own ok', async () => {
    const connection = makeConnection(async (data) => {
      if (data === '$X\n') {
        // GRBL order: the status requested while `$X\n` was arriving is
        // printed at the end-of-line check point, then `$X` executes.
        queueMicrotask(() => {
          connection.emitLine(ALARM);
          connection.emitLine('[MSG:Caution: Unlocked]');
          connection.emitLine('ok');
        });
      }
    });
    await connectWith(connection);
    connection.emitLine('ALARM:1');
    connection.emitLine(ALARM);
    await flushConnect();
    expect(useLaserStore.getState().alarmCode).toBe(1);

    const outcome = await useLaserStore
      .getState()
      .unlockAlarm()
      .then(
        () => 'unlocked',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    await flushConnect();

    expect({
      outcome,
      alarmCode: useLaserStore.getState().alarmCode,
      pendingUntrackedAcks: useLaserStore.getState().pendingUntrackedAcks,
    }).toEqual({ outcome: 'unlocked', alarmCode: null, pendingUntrackedAcks: 0 });
  });
});

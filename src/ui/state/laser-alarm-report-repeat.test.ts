// Only the status report that enters Alarm or Sleep voids the controller's
// owned exchanges and owed acknowledgements; a report that repeats the state is
// no new event (controller audit 2026-09-25 ST-3). GRBL keeps answering lines
// in Alarm, and a `?` served at a line's end-of-line check point reads Alarm
// just before that line runs:
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L79-L105
// so the reply to an operator's `$X` can follow an `<Alarm|...>` report.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  flushConnect,
  makeConnection,
  type FakeConnection,
} from './laser-store-console.test-support';

const ALARM = '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>';
const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

/** GRBL alarm 9 (homing failed) is an ordinary lock that `$X` clears. */
async function alarmed(connection: FakeConnection): Promise<void> {
  await connectWith(connection);
  connection.emitLine('ALARM:9');
  connection.emitLine(ALARM);
  await flushConnect();
  expect(useLaserStore.getState().alarmCode).toBe(9);
}

describe('status reports that repeat Alarm', () => {
  it('let an Unlock settle on its own ok after an Alarm report that raced it', async () => {
    const connection = makeConnection(async (data) => {
      if (data !== '$X\n') return;
      // GRBL order: the status requested while `$X\n` arrived is printed at the
      // end-of-line check point, then `$X` runs.
      queueMicrotask(() => {
        connection.emitLine(ALARM);
        connection.emitLine('[MSG:Caution: Unlocked]');
        connection.emitLine('ok');
      });
    });
    await alarmed(connection);

    await expect(useLaserStore.getState().unlockAlarm()).resolves.toBeUndefined();
    await flushConnect();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);

    connection.emitLine(IDLE);
    await flushConnect();
    expect(useLaserStore.getState().alarmCode).toBeNull();
  });

  it('keep a Console read sent in Alarm owed until its own reply', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await alarmed(connection);

    const read = useLaserStore.getState().sendConsoleCommand('$#');
    await vi.waitFor(() => expect(writes).toContain('$#\n'));
    connection.emitLine(ALARM);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    connection.emitLine('[G54:0.000,0.000,0.000]');
    connection.emitLine('ok');

    await expect(read).resolves.toBeUndefined();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('still void the exchange in flight when a report first says Alarm', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine(IDLE);
    await flushConnect();

    const read = useLaserStore.getState().sendConsoleCommand('$#');
    await vi.waitFor(() => expect(writes).toContain('$#\n'));
    connection.emitLine(ALARM);

    // Entering Alarm advances the write epoch, so the Console reports its
    // command's result as void.
    await expect(read).rejects.toThrow(/Controller entered Alarm|Serial session changed/);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });
});

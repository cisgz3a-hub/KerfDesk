// Controller audit gap-start-11: the Alarm banner's Unlock applied the
// unlocked state once the bytes left the port. It now owns the exchange like
// the Console's `$X`: an `error:N` rejects with its reason and keeps the alarm.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import { connectWith, flushConnect, makeConnection } from './laser-store-console.test-support';

const ALARM = '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

async function alarmedController(reply: string) {
  const writes: string[] = [];
  const connection = makeConnection(async (data) => {
    writes.push(data);
    if (data === '$X\n') queueMicrotask(() => connection.emitLine(reply));
  });
  await connectWith(connection);
  connection.emitLine('ALARM:1');
  connection.emitLine(ALARM);
  await flushConnect();
  expect(useLaserStore.getState().alarmCode).toBe(1);
  return { writes, connection };
}

describe('Alarm banner Unlock', () => {
  it('keeps the alarm and names the refusal when the controller answers error:N', async () => {
    const { writes } = await alarmedController('error:9');

    await expect(useLaserStore.getState().unlockAlarm()).rejects.toThrow(/error:9/);

    expect(writes).toContain('$X\n');
    expect(useLaserStore.getState().alarmCode).toBe(1);
  });

  // Controller audit 2026-09-25 HF-2: FluidNC acknowledges `$X` in its Critical
  // state without unlocking, so the `ok` alone clears nothing; the next report
  // that is not Alarm does.
  it('clears the alarm once the controller reports it left Alarm after the unlock', async () => {
    const { connection } = await alarmedController('ok');

    await useLaserStore.getState().unlockAlarm();
    expect(useLaserStore.getState().alarmCode).toBe(1);

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flushConnect();
    expect(useLaserStore.getState().alarmCode).toBeNull();
  });
});

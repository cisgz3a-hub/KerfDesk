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

  // Controller audit 2, M-1: a failed probe stops only the probe move, so the
  // Unlock after it keeps the Set origin and the reported position
  // (probe-failure-alarm.ts). The first report out of Alarm clears alarmCode
  // and can be handled before the Unlock's ok, so the alarm is read first.
  it('keeps the Set origin after a failed probe when Idle beats the Unlock ok', async () => {
    const idle = '<Idle|MPos:37.000,27.000,0.000|FS:0,0|WCO:25.000,15.000,0.000>';
    const connection = makeConnection(async (data) => {
      if (data !== '$X\n') return;
      queueMicrotask(() => {
        for (const line of ['[MSG:Caution: Unlocked]', idle, 'ok']) connection.emitLine(line);
      });
    });
    await connectWith(connection);
    // Set origin here left a trusted position and a G92 origin.
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g92',
      wcoCache: { x: 25, y: 15, z: 0 },
      positionEvidenceSuppressed: false,
    });
    connection.emitLine('ALARM:5');
    connection.emitLine(ALARM);
    await flushConnect();
    expect(useLaserStore.getState()).toMatchObject({ alarmCode: 5, workOriginSource: 'g92' });

    await useLaserStore.getState().unlockAlarm();

    expect(useLaserStore.getState()).toMatchObject({
      alarmCode: null,
      workOriginActive: true,
      workOriginSource: 'g92',
      positionEvidenceSuppressed: false,
      wcoCache: { x: 25, y: 15, z: 0 },
    });
    connection.emitLine(idle);
    await flushConnect();
    expect(useLaserStore.getState().statusReport?.mPos).toEqual({ x: 37, y: 27, z: 0 });
  });
});

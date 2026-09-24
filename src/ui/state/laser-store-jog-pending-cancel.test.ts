// Regression tests for audit finding jog-home-origin-2: a Cancel (a released
// press-and-hold arrow, Ctrl+.) that lands while jog()/frame() is still proving
// a fresh Idle must stop that motion before any of it reaches the wire.
//
// Oracle: GRBL ignores the realtime jog-cancel byte unless it is already in
// the Jog state ("Command is ignored, if not in a JOG state",
// https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands), so a 0x85 written to
// an Idle controller cannot cancel a $J= written after it. The only correct
// outcome is that the pending motion command is never written.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  getMotionOperation,
  makeConnection,
  type FakeConnection,
} from './laser-store-motion-operation.test-support';
import { MANUAL_MOTION_CANCELLED_MESSAGE } from './manual-motion-intent';

const IDLE_AT_100 = '<Idle|MPos:100.000,100.000,0.000|FS:0,0>';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    frameVerification: null,
    framedRun: null,
    lastWriteError: null,
    safetyNotice: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    wcoCache: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

async function drain(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

async function connectIdleAt100(writes: string[]): Promise<FakeConnection> {
  const connection = makeConnection(async (data) => {
    writes.push(data);
  });
  await connectWith(connection);
  await vi.waitFor(() => expect(useLaserStore.getState().controllerOperation).toBeNull());
  connection.emitLine(IDLE_AT_100);
  await drain();
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return connection;
}

// Moves the clock, not the observation record, so the cached Idle ages past
// the freshness window the way it does between two idle polls.
function ageCachedStatus(): void {
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 5_000);
}

function outcomeOf(pending: Promise<void>): Promise<string> {
  return pending.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

const MOTION_ACTIONS = [
  ['a continuous jog', () => useLaserStore.getState().jog({ dx: 300, feed: 3000 })],
  ['a jog to a machine point', () => useLaserStore.getState().jogToMachinePosition(10, 10, 3000)],
  ['a Frame', () => useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 20, maxY: 20 }, 3000)],
] as const;

describe('Cancel before a jog or Frame installs its motion owner', () => {
  it.each(MOTION_ACTIONS)(
    'writes nothing of %s after the operator cancelled',
    async (_label, start) => {
      const writes: string[] = [];
      const connection = await connectIdleAt100(writes);
      ageCachedStatus();
      writes.length = 0;

      const outcome = outcomeOf(start());
      // The action is proving fresh Idle: its status query is out, no owner yet.
      await vi.waitFor(() => expect(writes).toContain('?'));
      expect(getMotionOperation()).toBeNull();

      await useLaserStore.getState().cancelJog();
      // The pending action fails at once; it does not wait for the reply.
      expect(await outcome).toBe(MANUAL_MOTION_CANCELLED_MESSAGE);
      const releasedAt = writes.length;

      connection.emitLine(IDLE_AT_100);
      await drain();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await drain();

      expect(writes.slice(releasedAt)).toEqual(
        writes.slice(releasedAt).filter((write) => write === '?'),
      );
      expect(writes.filter((write) => write.startsWith('$J='))).toEqual([]);
      expect(writes).toContain(RT_JOG_CANCEL);
      expect(getMotionOperation()).toBeNull();
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
  );

  it('does not poison a jog the operator starts after the Cancel', async () => {
    const writes: string[] = [];
    const connection = await connectIdleAt100(writes);
    ageCachedStatus();
    await useLaserStore.getState().cancelJog();
    writes.length = 0;

    const outcome = outcomeOf(useLaserStore.getState().jog({ dx: 5, feed: 1000 }));
    await vi.waitFor(() => expect(writes).toContain('?'));
    // Let the jog stamp its query before the controller answers it.
    await drain();
    connection.emitLine(IDLE_AT_100);

    expect(await outcome).toBe('resolved');
    expect(writes).toContain('$J=G91 G21 X5.000 F1000\n');
  });
});

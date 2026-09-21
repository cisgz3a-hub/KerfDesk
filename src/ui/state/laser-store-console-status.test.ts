import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import { connectWith, makeConnection } from './laser-store-console.test-support';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerOperation: null,
    motionOperation: null,
    log: [],
    transcript: [],
  });
  vi.restoreAllMocks();
});

describe('laser-store requestControllerStatus', () => {
  it('writes one realtime status query outside the periodic poll', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    // Realtime: no newline, no owed ok; resolves on the write alone.
    await useLaserStore.getState().requestControllerStatus();
    expect(writes).toEqual(['?']);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('stays silent while a controller operation owns polling', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;
    useLaserStore.setState({ controllerOperation: { kind: 'start-arming', phase: 'queue-fence' } });

    await useLaserStore.getState().requestControllerStatus();
    expect(writes).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_SOFT_RESET } from '../../core/controllers/grbl';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  flush,
  getMotionOperation,
  makeConnection,
  setMotionOperation,
} from './laser-store-motion-operation.test-support';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    lastWriteError: null,
    safetyNotice: null,
    streamer: null,
    motionOperation: null,
    frameVerification: null,
    framedRun: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
});

describe('laser-store motion operation disconnect safety', () => {
  it('resets and de-energizes before disconnecting an active Frame operation', async () => {
    const close = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write, close);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: true, dispatchComplete: true });

    write.mockClear();
    const disconnect = useLaserStore.getState().disconnect();
    await flush();

    expect(write).toHaveBeenCalledWith(RT_SOFT_RESET);
    expect(write).not.toHaveBeenCalledWith('M5\n');
    expect(close).not.toHaveBeenCalled();

    connection.emitLine('Grbl 1.1f');
    await disconnect;

    expect(write).toHaveBeenCalledWith('M5\n');
    expect(write).toHaveBeenCalledWith('M9\n');
    expect(close).toHaveBeenCalledTimes(1);
    expect(getMotionOperation()).toBeNull();
  });

  it('raises a disconnect safety notice if Frame jog-cancel fails before disconnect', async () => {
    let shouldFail = false;
    const write = vi.fn(async () => {
      if (shouldFail) throw new Error('cancel rejected');
    });
    const connection = makeConnection(write);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: true, dispatchComplete: true });

    shouldFail = true;
    await useLaserStore.getState().disconnect();

    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'disconnect',
    });
    expect(getMotionOperation()).toBeNull();
  });
});

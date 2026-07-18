import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { useLaserStore } from './laser-store';
import {
  connectWith,
  framedRunCandidate,
  getMotionOperation,
  makeConnection,
  setMotionOperation,
  type FakeConnection,
} from './laser-store-motion-operation.test-support';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    frameVerification: null,
    framedRun: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
});

describe('motion-cancel authorization and status races', () => {
  it('expires a completed framed-run permit without an active motion owner', async () => {
    const write = vi.fn(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    const candidate = framedRunCandidate();
    useLaserStore.setState((state) => ({
      motionOperation: null,
      framedRun: {
        kind: 'ready',
        candidate,
        completedStatusSequence: state.statusSequence,
        controller: candidate.controllerBeforeFrame,
      },
      frameVerification: candidate.frameVerification,
    }));

    write.mockClear();
    await useLaserStore.getState().cancelJog();

    expect(write).toHaveBeenCalledWith(RT_JOG_CANCEL);
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });

  it('accepts post-marker Idle before the confirming query transport settles', async () => {
    let releaseQuery!: () => void;
    let queryCount = 0;
    let respondToCancelQuery = false;
    const writes: string[] = [];
    const connection: FakeConnection = makeConnection(async (data) => {
      writes.push(data);
      if (data !== '?' || !respondToCancelQuery) return;
      queryCount += 1;
      connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
      await new Promise<void>((resolve) => {
        releaseQuery = resolve;
      });
    });
    await connectWith(connection);
    writes.length = 0;
    queryCount = 0;
    respondToCancelQuery = true;
    setMotionOperation({ kind: 'frame', sawControllerBusy: false });

    const cancel = useLaserStore.getState().cancelJog();
    await vi.waitFor(() => expect(writes).toContain('G4 P0.01\n'));

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(getMotionOperation()).toMatchObject({ cancelRequested: true });
    connection.emitLine('ok');
    await vi.waitFor(() => expect(queryCount).toBe(1));

    expect(getMotionOperation()).toBeNull();
    expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
    releaseQuery();
    await cancel;
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
  });
});

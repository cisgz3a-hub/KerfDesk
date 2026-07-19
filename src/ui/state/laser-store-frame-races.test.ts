import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { startMotionOperation } from './laser-motion-operation';
import { useLaserStore } from './laser-store';
import {
  acknowledgeAndSettleFrameLeg,
  acknowledgeFrameToolOffPrelude,
  connectWith,
  flush,
  framedRunCandidate,
  makeConnection,
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

describe('Frame transport and permit races', () => {
  it('waits for the current leg terminal response before dispatching the next leg', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
    await acknowledgeFrameToolOffPrelude(connection);
    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();

    expect(frameJogWrites(writes)).toEqual(['$J=G90 G21 X0.000 Y0.000 F1000\n']);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(frameJogWrites(writes)).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
      '$J=G90 G21 X10.000 Y0.000 F1000\n',
    ]);
  });

  it('does not treat an in-flight status-poll transport as a Frame write', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;
    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
    await acknowledgeFrameToolOffPrelude(connection);

    useLaserStore.setState({ pendingTransportWrites: 1 });
    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();

    expect(frameJogWrites(writes)).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
      '$J=G90 G21 X10.000 Y0.000 F1000\n',
    ]);
  });

  it('withholds the permit until transport settles and revokes on late rejection', async () => {
    let rejectFirstFrameWrite: ((error: Error) => void) | undefined;
    let deferFrameWrite = false;
    const connection = makeConnection((data) => {
      if (deferFrameWrite && data === 'M5\n') {
        return new Promise<void>((_resolve, reject) => {
          rejectFirstFrameWrite = reject;
        });
      }
      return Promise.resolve();
    });
    await connectWith(connection);
    deferFrameWrite = true;
    const frame = useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
    await flush();

    await acknowledgeFrameToolOffPrelude(connection);
    for (let leg = 0; leg < 4; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().pendingTransportWrites).toBe(1);
    expect(useLaserStore.getState().framedRun).toBeNull();

    rejectFirstFrameWrite?.(new Error('late adapter rejection'));
    await expect(frame).rejects.toThrow('late adapter rejection');
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      kind: 'frame',
      cancelRequested: true,
    });
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });

  it('cannot mint a permit from final Idle after cancellation begins', async () => {
    let releaseCancel!: () => void;
    const writes: string[] = [];
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    const connection = makeConnection((data) => {
      writes.push(data);
      return data === RT_JOG_CANCEL ? cancelGate : Promise.resolve();
    });
    await connectWith(connection);
    writes.length = 0;
    const candidate = framedRunCandidate();
    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, candidate);
    await acknowledgeFrameToolOffPrelude(connection);
    for (let leg = 0; leg < 4; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
    connection.emitLine('ok');

    const cancel = useLaserStore.getState().cancelJog();
    await flush();
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      cancelRequested: true,
    });
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();

    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(useLaserStore.getState().motionOperation).toMatchObject({ cancelRequested: true });
    releaseCancel();
    await vi.waitFor(() => expect(writes.at(-1)).toBe('?'));
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await vi.waitFor(() => expect(writes).toContain('G4 P0.01\n'));
    connection.emitLine('ok');
    await vi.waitFor(() => expect(writes.at(-1)).toBe('?'));
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await cancel;
    expect(useLaserStore.getState().motionOperation).toBeNull();
  });

  it('releases a cancelled tool-off prefix only after its old ack and fresh Idle', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;
    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
    const cancel = useLaserStore.getState().cancelJog();
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      cancelRequested: true,
      acknowledgedPrefixLinesRemaining: 2,
    });

    connection.emitLine('ok');
    await vi.waitFor(() => expect(writes.at(-1)).toBe('?'));
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await vi.waitFor(() => expect(writes).toContain('G4 P0.01\n'));
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      cancelRequested: true,
      acknowledgedPrefixLinesRemaining: 2,
    });
    connection.emitLine('ok');
    await vi.waitFor(() => expect(writes.at(-1)).toBe('?'));
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await cancel;

    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it('does not apply Frame A terminal ok to Frame B installed by the ack-settlement update', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    const candidateA = framedRunCandidate();
    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, candidateA);
    useLaserStore.setState((state) => ({
      motionOperation:
        state.motionOperation === null ? null : { ...state.motionOperation, cancelRequested: true },
      frameVerification: null,
      framedRun: null,
    }));
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    const operationA = useLaserStore.getState().motionOperation;
    if (operationA === null)
      throw new Error('Frame A operation was not retained for cancellation.');

    const candidateB = framedRunCandidate();
    const operationB = startMotionOperation('frame', ['M9\n'], candidateB, 2);
    let installedB = false;
    const unsubscribe = useLaserStore.subscribe((state, previous) => {
      if (!installedB && previous.pendingUntrackedAcks > 0 && state.pendingUntrackedAcks === 0) {
        installedB = true;
        useLaserStore.setState({ motionOperation: operationB });
      }
    });
    writes.length = 0;
    connection.emitLine('ok');
    await flush();
    unsubscribe();

    expect(installedB).toBe(true);
    expect(writes).toEqual([]);
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      operationId: operationB.operationId,
      kind: 'frame',
      candidate: candidateB,
      acknowledgedPrefixLinesRemaining: 2,
    });
    expect(operationB.operationId).not.toBe(operationA.operationId);
    useLaserStore.setState({ motionOperation: null });
  });

  it.each(['resolve', 'reject'] as const)(
    'isolates Frame B from Frame A late transport %s callbacks',
    async (settlement) => {
      let resolveA!: () => void;
      let rejectA!: (error: Error) => void;
      const gateA = new Promise<void>((resolve, reject) => {
        resolveA = resolve;
        rejectA = reject;
      });
      let deferFrameWrites = false;
      const connection = makeConnection((data) => {
        if (!deferFrameWrites || data !== 'M5\n') return Promise.resolve();
        return gateA;
      });
      await connectWith(connection);
      deferFrameWrites = true;
      const candidateA = framedRunCandidate();
      const frameA = useLaserStore
        .getState()
        .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, candidateA)
        .then(
          () => null,
          (error: unknown) => error,
        );
      await flush();
      const operationA = useLaserStore.getState().motionOperation;
      if (operationA === null) throw new Error('Frame A operation was not installed.');
      useLaserStore.setState((state) => ({
        motionOperation:
          state.motionOperation?.operationId === operationA.operationId
            ? { ...state.motionOperation, cancelRequested: true }
            : state.motionOperation,
        frameVerification: null,
        framedRun: null,
      }));

      await expect(
        useLaserStore
          .getState()
          .frame({ minX: 1, minY: 1, maxX: 11, maxY: 11 }, 1000, framedRunCandidate()),
      ).rejects.toThrow(/operation is active|previous controller write and acknowledgement/i);
      connection.emitLine('ok');
      await flush();

      const candidateB = framedRunCandidate();
      const operationB = startMotionOperation('frame', ['M9\n'], candidateB, 2, 1);
      let installedB = false;
      const unsubscribe = useLaserStore.subscribe((state, previous) => {
        if (
          !installedB &&
          (previous.pendingTransportWrites ?? 0) > 0 &&
          state.pendingTransportWrites === 0 &&
          state.pendingUntrackedAcks === 0
        ) {
          installedB = true;
          useLaserStore.setState({ motionOperation: operationB });
        }
      });
      if (settlement === 'resolve') resolveA();
      else rejectA(new Error('Frame A settled late'));
      await flush();
      unsubscribe();
      const resultA = await frameA;
      if (settlement === 'reject') expect(resultA).toBeInstanceOf(Error);
      expect(installedB).toBe(true);

      expect(useLaserStore.getState().motionOperation).toMatchObject({
        operationId: operationB.operationId,
        kind: 'frame',
        candidate: candidateB,
        dispatchComplete: false,
        pendingMotionTransportWrites: 1,
      });
      expect(operationB.operationId).not.toBe(operationA.operationId);
      useLaserStore.setState({ motionOperation: null });
    },
  );

  it('retains the following ack when an early-acked write rejects after dispatching it', async () => {
    let rejectFirstFrameWrite!: (error: Error) => void;
    let deferFrameWrite = false;
    const connection = makeConnection((data) => {
      if (deferFrameWrite && data === 'M5\n') {
        return new Promise<void>((_resolve, reject) => {
          rejectFirstFrameWrite = reject;
        });
      }
      return Promise.resolve();
    });
    await connectWith(connection);
    deferFrameWrite = true;

    const frame = useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
    await flush();
    connection.emitLine('ok');
    await flush();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    rejectFirstFrameWrite(new Error('first transport rejected after early ok'));
    await expect(frame).rejects.toThrow('first transport rejected after early ok');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(useLaserStore.getState().motionOperation).toMatchObject({ cancelRequested: true });
    await expect(
      useLaserStore
        .getState()
        .frame({ minX: 1, minY: 1, maxX: 11, maxY: 11 }, 1000, framedRunCandidate()),
    ).rejects.toThrow(/operation is active|previous controller write and acknowledgement/i);

    connection.emitLine('ok');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().motionOperation).toMatchObject({ cancelRequested: true });
  });

  it('quarantines an ambiguously rejected queued write until its late ack or reconnect', async () => {
    let rejectFirstFrameWrite!: (error: Error) => void;
    let deferFrameWrite = false;
    const connection = makeConnection((data) => {
      if (deferFrameWrite && data === 'M5\n') {
        return new Promise<void>((_resolve, reject) => {
          rejectFirstFrameWrite = reject;
        });
      }
      return Promise.resolve();
    });
    await connectWith(connection);
    deferFrameWrite = true;

    const frame = useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
    await flush();
    rejectFirstFrameWrite(new Error('ambiguous queued rejection'));
    await expect(frame).rejects.toThrow('ambiguous queued rejection');

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(useLaserStore.getState().motionOperation).toMatchObject({ cancelRequested: true });
    await expect(useLaserStore.getState().jog({ dx: 1, feed: 500 })).rejects.toThrow(
      /operation is active|previous controller write and acknowledgement/i,
    );
    // Isolate the acknowledgement tombstone from the failed operation owner:
    // even if another recovery path retires that owner, Start remains fenced.
    useLaserStore.setState({ motionOperation: null });
    await expect(useLaserStore.getState().startJob('G21\nG90\nM5\n')).rejects.toThrow(
      /terminal acknowledgement is still owed/i,
    );

    connection.emitLine('ok');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it.each(['Run', 'Jog', 'Hold', 'Door', 'Check', 'Home', 'Tool'] as const)(
    'permanently expires a completed permit after controller state %s',
    async (controllerState) => {
      const connection = makeConnection(async () => undefined);
      await connectWith(connection);
      const candidate = framedRunCandidate();
      useLaserStore.setState((state) => ({
        framedRun: {
          kind: 'ready',
          candidate,
          completedStatusSequence: state.statusSequence,
          controller: candidate.controllerBeforeFrame,
        },
        frameVerification: candidate.frameVerification,
      }));

      connection.emitLine(`<${controllerState}|MPos:0.000,0.000,0.000|FS:0,0>`);
      connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
      expect(useLaserStore.getState().framedRun).toBeNull();
      expect(useLaserStore.getState().frameVerification).toBeNull();
    },
  );
});

function frameJogWrites(writes: ReadonlyArray<string>): ReadonlyArray<string> {
  return writes.filter((line) => line.startsWith('$J='));
}

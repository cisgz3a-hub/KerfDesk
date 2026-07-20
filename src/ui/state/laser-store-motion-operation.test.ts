import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_JOG_CANCEL } from '../../core/controllers/grbl';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';
import { useStore } from './store';
import {
  acknowledgeAndSettleFrameLeg,
  acknowledgeFrameToolOffPrelude,
  acknowledgeMotionSettlement,
  acknowledgeToolOffLine,
  connectWith as connectWithBase,
  type FakeConnection,
  framedRunCandidate,
  getMotionOperation,
  makeConnection as makeConnectionBase,
  setMotionOperation,
} from './laser-store-motion-operation.test-support';

function makeConnection(
  write: (data: string) => Promise<void>,
  close: () => Promise<void> = async () => undefined,
): FakeConnection {
  let emitLine = (_line: string): void => undefined;
  const connection = makeConnectionBase(async (data) => {
    await write(data);
    respondToTestGrblHandshake(data, emitLine);
  }, close);
  emitLine = connection.emitLine;
  return connection;
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await connectWithBase(connection);
  await settleTestGrblHandshake();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  useStore.getState().setMachineKind('laser');
  useLaserStore.setState({ autofocusBusy: false });
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

describe('laser-store motion operation lifecycle', () => {
  it('writes a jog when detected firmware differs from the user-selected profile', async () => {
    const write = vi.fn(async (_data: string) => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    useLaserStore.setState({ detectedControllerKind: 'grblhal' });
    write.mockClear();

    await useLaserStore.getState().jog({ dx: 10, feed: 1000 });
    expect(write).toHaveBeenCalledWith('$J=G91 G21 X10.000 F1000\n');
  });

  it('keeps Jog busy until GRBL reports motion and returns to Idle', async () => {
    const writes: string[] = [];
    const write = vi.fn(async (data: string) => {
      writes.push(data);
    });
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().jog({ dx: 10, feed: 1000 });

    expect(getMotionOperation()).toMatchObject({ kind: 'jog', sawControllerBusy: false });

    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toMatchObject({ kind: 'jog', sawControllerBusy: true });

    connection.emitLine('<Idle|MPos:10.000,10.000,0.000|FS:0,0>');
    await flush();

    expect(writes).toEqual(['$J=G91 G21 X10.000 F1000\n']);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(getMotionOperation()).toMatchObject({ kind: 'jog', sawControllerBusy: true });

    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:10.000,10.000,0.000|FS:0,0>');
    await flush();
    expect(writes.at(-1)).toBe('G4 P0.01\n');
    expect(getMotionOperation()).toMatchObject({
      kind: 'jog',
      awaitingSettlementAck: true,
    });
    connection.emitLine('<Idle|MPos:10.000,10.000,0.000|FS:0,0>');
    expect(getMotionOperation()).not.toBeNull();
    await acknowledgeMotionSettlement(connection);
    expect(getMotionOperation()).toBeNull();
  });

  it('dispatches Frame jog legs one at a time after each leg completes', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000);

    expect(writes).toEqual(['M5\n']);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(writes).toEqual(['M5\n']);

    await acknowledgeToolOffLine(connection);
    expect(writes).toEqual(['M5\n', 'M9\n']);
    await acknowledgeToolOffLine(connection);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
    ]);
    expect(getMotionOperation()).toMatchObject({ kind: 'frame', sawControllerBusy: false });

    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await Promise.resolve();

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
      '$J=G90 G21 X10.000 Y0.000 F1000\n',
    ]);
    expect(getMotionOperation()).toMatchObject({ kind: 'frame', sawControllerBusy: false });
  });

  it('does not begin Frame motion when the controller rejects a tool-off command', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
    expect(writes).toEqual(['M5\n']);

    connection.emitLine('error:20');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();

    expect(writes.some((line) => line.startsWith('$J='))).toBe(false);
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      kind: 'frame',
      cancelRequested: true,
    });
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });

  it('issues the exact framed-run permit only after the final Frame leg reaches Idle', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    const candidate = framedRunCandidate();
    const completionSnapshots: ReadonlyArray<unknown>[] = [];
    const unsubscribe = useLaserStore.subscribe((state, previous) => {
      if (
        previous.motionOperation?.kind === 'frame' &&
        previous.motionOperation.candidate === candidate &&
        state.motionOperation === null
      ) {
        completionSnapshots.push([state.framedRun, state.frameVerification]);
      }
    });

    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, candidate);

    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    await acknowledgeFrameToolOffPrelude(connection);
    for (let leg = 0; leg < 4; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(useLaserStore.getState().motionOperation).not.toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();

    connection.emitLine('ok');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().motionOperation).not.toBeNull();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    await flush();
    expect(writes.at(-1)).toBe('G4 P0.01\n');
    expect(useLaserStore.getState().framedRun).toBeNull();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().framedRun).toBeNull();
    await acknowledgeMotionSettlement(connection);

    const state = useLaserStore.getState();
    expect(state.motionOperation).toBeNull();
    expect(state.framedRun?.candidate).toBe(candidate);
    expect(state.framedRun?.completedStatusSequence).toBe(state.statusSequence);
    expect(state.framedRun?.controller.statusReport?.state).toBe('Idle');
    expect(state.frameVerification).toBe(candidate.frameVerification);
    expect(completionSnapshots).toEqual([[state.framedRun, candidate.frameVerification]]);
    unsubscribe();
  });

  it('does not issue a permit when the settlement marker errors after physical Frame', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    const candidate = framedRunCandidate();
    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, candidate);

    await acknowledgeFrameToolOffPrelude(connection);
    for (let leg = 0; leg < 4; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().motionOperation).not.toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();

    connection.emitLine('error:33');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().motionOperation).toMatchObject({
      kind: 'frame',
      cancelRequested: true,
    });
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });

  it.each(['Hold', 'Door', 'Check', 'Home', 'Tool'] as const)(
    'invalidates the Frame candidate when the controller reports %s',
    async (controllerState) => {
      const connection = makeConnection(async () => undefined);
      await connectWith(connection);
      await useLaserStore
        .getState()
        .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());

      connection.emitLine(`<${controllerState}|MPos:0.000,0.000,0.000|FS:0,0>`);
      expect(useLaserStore.getState().motionOperation).toBeNull();
      expect(useLaserStore.getState().framedRun).toBeNull();
      expect(useLaserStore.getState().frameVerification).toBeNull();
      expect(useLaserStore.getState().lastWriteError).toContain(controllerState);

      connection.emitLine('ok');
      connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
      expect(useLaserStore.getState().framedRun).toBeNull();
    },
  );

  it('does not issue a permit when origin evidence changes during Frame', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    const candidate = framedRunCandidate();
    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, candidate);

    await acknowledgeFrameToolOffPrelude(connection);
    for (let leg = 0; leg < 4; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|WCO:1.000,0.000,0.000|FS:0,0>');
    await acknowledgeMotionSettlement(
      connection,
      '<Idle|MPos:0.000,0.000,0.000|WCO:1.000,0.000,0.000|FS:0,0>',
    );

    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(useLaserStore.getState().lastWriteError).toMatch(/changed during Frame/i);
  });

  it('retracts to safe Z, then queues a restore to the pre-frame Z, when work Z is set (CNC)', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    // A current work-Z zero plus a WPos-bearing Idle so the pre-frame Z is known.
    useLaserStore.setState({
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 1 },
      workZReferenceEpoch: 1,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    connection.emitLine('<Idle|WPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000);

    expect(writes).toEqual(['M5\n']);
    await acknowledgeFrameToolOffPrelude(connection);

    // Default CNC safe Z is 3.81 mm above stock top; the retract must complete
    // before any XY leg so the bit is clear of the material.
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual(['$J=G90 G21 Z3.810 F1000\n']);
    // The queued tail ends with a restore back to the pre-frame Z (Z0) so the
    // bit does not stay parked at safe height (ADR-192).
    const pending = (
      useLaserStore.getState() as {
        readonly motionOperation: { readonly pendingLines: ReadonlyArray<string> } | null;
      }
    ).motionOperation?.pendingLines;
    expect(pending?.[pending.length - 2]).toBe('$J=G90 G21 Z0.000 F1000\n');
    expect(pending?.[pending.length - 1]).toBe('G4 P0.01\n');
  });

  it('blocks CNC Frame before writing when no work-Z zero is set', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    useLaserStore.setState({
      workZZeroEvidence: null,
      workZReferenceEpoch: 0,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await expect(
      useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000),
    ).rejects.toThrow(/CNC Frame requires a current work Z zero/i);
    expect(writes).toEqual([]);
  });

  it('stops dispatching Frame legs after the controller rejects a jog command', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());
    await acknowledgeFrameToolOffPrelude(connection);
    connection.emitLine('error:7002009');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G90 G21 X0.000 Y0.000 F1000\n',
    ]);
    expect(getMotionOperation()).toMatchObject({
      kind: 'frame',
      cancelRequested: true,
    });
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'controller-error',
      raw: 'error:7002009',
    });
    expect(useLaserStore.getState().safetyNotice?.message).toMatch(/rejected a frame command/i);
  });

  it('clears Frame after stable Idle reports when polling misses the Jog state', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: false, dispatchComplete: true });

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toMatchObject({ kind: 'frame', sawControllerBusy: false });

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });

  it('does not clear Frame on stable Idle before frame writes finish dispatching', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: false, dispatchComplete: false });

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(getMotionOperation()).toMatchObject({ kind: 'frame', dispatchComplete: false });
  });

  it('sends jog-cancel and clears the active operation on a fresh post-cancel Idle', async () => {
    const write = vi.fn(async (_data: string) => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: false });

    write.mockClear();
    const cancel = useLaserStore.getState().cancelJog();

    expect(write).toHaveBeenCalledWith(RT_JOG_CANCEL);
    expect(getMotionOperation()).toMatchObject({ cancelRequested: true });
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('?'));
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('G4 P0.01\n'));
    connection.emitLine('ok');
    await vi.waitFor(() =>
      expect(write.mock.calls.filter(([line]) => line === '?')).toHaveLength(2),
    );
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await cancel;
    expect(getMotionOperation()).toBeNull();
  });

  it('retains a cancelled owner when jog-cancel write fails', async () => {
    let rejectWrites = false;
    const write = vi.fn(async (_data: string) => {
      if (rejectWrites) throw new Error('cancel rejected');
    });
    const connection = makeConnection(write);
    await connectWith(connection);
    setMotionOperation({ kind: 'frame', sawControllerBusy: false });
    rejectWrites = true;

    await expect(useLaserStore.getState().cancelJog()).rejects.toThrow('cancel rejected');

    expect(getMotionOperation()).toMatchObject({
      kind: 'frame',
      cancelRequested: true,
    });
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(getMotionOperation()).toMatchObject({
      kind: 'frame',
      cancelRequested: true,
    });
  });
});

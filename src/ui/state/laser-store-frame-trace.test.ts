import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';
import { useStore } from './store';
import {
  acknowledgeAndSettleFrameLeg,
  acknowledgeFrameToolOffPrelude,
  acknowledgeMotionSettlement,
  connectWith as connectWithBase,
  type FakeConnection,
  framedRunCandidate,
  frameTraceCandidate,
  makeConnection as makeConnectionBase,
} from './laser-store-motion-operation.test-support';

// A trace candidate rides the same physical Frame as an exact candidate, and
// the same clean-Idle completion boundary publishes it — but as `frameTrace`,
// never as a permit (ADR-353).

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  let emitLine = (_line: string): void => undefined;
  const connection = makeConnectionBase(async (data) => {
    await write(data);
    respondToTestGrblHandshake(data, emitLine);
  });
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

async function runFrameLegsToSettlement(connection: FakeConnection): Promise<void> {
  await acknowledgeFrameToolOffPrelude(connection);
  for (let leg = 0; leg < 4; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
  connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  useStore.getState().setMachineKind('laser');
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
    frameTrace: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
});

describe('laser-store frame trace completion (ADR-353)', () => {
  it('records the trace at the final clean Idle and never a permit', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    const candidate = frameTraceCandidate();

    await useLaserStore
      .getState()
      .traceFrame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, candidate);

    expect(writes.length).toBeGreaterThan(0);
    expect(useLaserStore.getState().motionOperation).toMatchObject({ kind: 'frame', candidate });
    expect(useLaserStore.getState().frameTrace).toBeNull();
    await runFrameLegsToSettlement(connection);
    expect(useLaserStore.getState().frameTrace).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
    await acknowledgeMotionSettlement(connection);

    const state = useLaserStore.getState();
    expect(state.motionOperation).toBeNull();
    expect(state.frameTrace?.candidate).toBe(candidate);
    expect(state.frameTrace?.completedStatusSequence).toBe(state.statusSequence);
    expect(state.frameTrace?.controller.statusReport?.state).toBe('Idle');
    expect(state.framedRun).toBeNull();
    expect(state.frameVerification).toBeNull();
  });

  it('voids a pending trace the moment another physical Frame is dispatched', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    const traced = frameTraceCandidate();
    await useLaserStore
      .getState()
      .traceFrame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, traced);
    await runFrameLegsToSettlement(connection);
    await acknowledgeMotionSettlement(connection);
    expect(useLaserStore.getState().frameTrace?.candidate).toBe(traced);

    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, framedRunCandidate());

    expect(useLaserStore.getState().frameTrace).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it('records no trace when the settlement marker errors after the physical trace', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    const candidate = frameTraceCandidate();
    await useLaserStore
      .getState()
      .traceFrame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, candidate);

    await acknowledgeFrameToolOffPrelude(connection);
    for (let leg = 0; leg < 4; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
    connection.emitLine('<Jog|MPos:0.000,0.000,0.000|FS:1000,0>');
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    connection.emitLine('error:33');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(useLaserStore.getState().motionOperation).toMatchObject({
      kind: 'frame',
      cancelRequested: true,
    });
    expect(useLaserStore.getState().frameTrace).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
  });
});

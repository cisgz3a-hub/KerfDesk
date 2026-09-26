import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import {
  acknowledgeFrameToolOffPrelude,
  connectWith as connectWithBase,
  type FakeConnection,
  makeConnection as makeConnectionBase,
} from './laser-store-motion-operation.test-support';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';
import { useStore } from './store';

// A recovery Frame follows the saved job's mode, not the open canvas (ADR-416).

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
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
});

describe('Frame for a saved job', () => {
  it('frames a saved laser job as a laser Frame while the open canvas is CNC', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    const laserJob = useStore.getState().project;
    useStore.getState().setMachineKind('cnc');
    useLaserStore.setState({
      workZZeroEvidence: null,
      workZReferenceEpoch: 0,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore
      .getState()
      .frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1000, undefined, laserJob);
    await acknowledgeFrameToolOffPrelude(connection);

    const jogs = writes.filter((line) => line.startsWith('$J='));
    expect(jogs.length).toBeGreaterThan(0);
    expect(jogs.some((line) => /Z/.test(line))).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { createProject } from '../../core/scene';
import { TOOL_CHANGE_LOAD_PREFIX } from '../../core/output';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { useStore } from './store';

type ConnectionBehavior = {
  autoResetBanner: boolean;
  reject: (data: string) => boolean;
  beforeProtocol?: (data: string) => Promise<void>;
};

type ResetSnapshot = {
  readonly status: string | null;
  readonly inFlight: number;
  readonly queued: number;
};

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
  readonly closeCount: () => number;
  readonly resetSnapshots: ReadonlyArray<ResetSnapshot>;
};

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:>';
const SOFT_RESET = '\x18';
const REFILL_LINE = 'G1 X1234567892\n';

let liveBehavior: ConnectionBehavior | null = null;

function makeConnection(writes: string[], behavior: ConnectionBehavior): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  let closes = 0;
  const resetSnapshots: ResetSnapshot[] = [];
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      await behavior.beforeProtocol?.(data);
      if (behavior.reject(data)) throw new Error('job transport rejected');
      handleProtocolWrite(connection, data, behavior, resetSnapshots);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => {
      closes += 1;
    },
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
    closeCount: () => closes,
    resetSnapshots,
  };
  return connection;
}

function handleProtocolWrite(
  connection: FakeConnection,
  data: string,
  behavior: ConnectionBehavior,
  resetSnapshots: ResetSnapshot[],
): void {
  if (data === SOFT_RESET) {
    const streamer = useLaserStore.getState().streamer;
    resetSnapshots.push({
      status: streamer?.status ?? null,
      inFlight: streamer?.inFlight.length ?? 0,
      queued: streamer?.queued.length ?? 0,
    });
    if (behavior.autoResetBanner) connection.emitLine('Grbl 1.1f');
  }
  if (data === 'G4 P0.01\n') setTimeout(() => connection.emitLine('ok'), 0);
  if (data === '?') setTimeout(() => connection.emitLine(IDLE), 0);
}

function adapterFor(connection: SerialConnection): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

async function connectReady(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine(IDLE);
  await vi.waitFor(() =>
    expect(useLaserStore.getState().controllerOperation).toMatchObject({ phase: 'settings' }),
  );
  connection.emitLine('$32=1');
  connection.emitLine('ok');
  await vi.waitFor(() => expect(useLaserStore.getState().controllerOperation).toBeNull());
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  if (liveBehavior !== null) liveBehavior.autoResetBanner = true;
  await useLaserStore.getState().disconnect();
  liveBehavior = null;
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('active-job transport write containment', () => {
  it('cancels ownership before resetting and quarantining an initial Start write rejection', async () => {
    const writes: string[] = [];
    let rejectInitial = false;
    const behavior: ConnectionBehavior = {
      autoResetBanner: true,
      reject: (data) => rejectInitial && data.includes('G21'),
    };
    const connection = makeConnection(writes, behavior);
    liveBehavior = behavior;
    await connectReady(connection);
    writes.length = 0;
    rejectInitial = true;

    await expect(
      useLaserStore
        .getState()
        .startJob('G21\nG90\nM4 S0\nG1 X1 S100\nM5\n', { runId: 'run-first-write-reject' }),
    ).rejects.toThrow('job transport rejected');
    await flush();

    expect(connection.resetSnapshots).toEqual([{ status: 'cancelled', inFlight: 0, queued: 0 }]);
    expect(writes.filter((data) => data === SOFT_RESET)).toHaveLength(1);
    expect(writes.filter((data) => data === 'M5\n')).toHaveLength(1);
    expect(writes.filter((data) => data === 'M9\n')).toHaveLength(1);
    await vi.waitFor(() => expect(connection.closeCount()).toBe(1));
    expect(connection.closeCount()).toBe(1);
    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      safetyNotice: { kind: 'write-failed', action: 'start' },
    });
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(useLaserStore.getState().activeRunId).toBeNull();
  });

  it('joins operator Disconnect to one reset when an ack-triggered refill write rejects', async () => {
    const writes: string[] = [];
    let rejectRefill = false;
    const behavior: ConnectionBehavior = {
      autoResetBanner: false,
      reject: (data) => rejectRefill && data === REFILL_LINE,
    };
    const connection = makeConnection(writes, behavior);
    liveBehavior = behavior;
    await connectReady(connection);
    await useLaserStore
      .getState()
      .startJob('G1 X1234567890\nG1 X1234567891\nG1 X1234567892\nG1 X1234567893\n', {
        rxBufferBytes: 30,
      });
    writes.length = 0;
    rejectRefill = true;

    connection.emitLine('ok');
    await flush();
    expect(connection.resetSnapshots).toEqual([{ status: 'cancelled', inFlight: 0, queued: 0 }]);
    const disconnect = useLaserStore.getState().disconnect();
    await flush();
    connection.emitLine('Grbl 1.1f');
    await disconnect;
    await flush();

    expect(connection.resetSnapshots).toEqual([{ status: 'cancelled', inFlight: 0, queued: 0 }]);
    expect(writes.filter((data) => data === SOFT_RESET)).toHaveLength(1);
    expect(writes.filter((data) => data === 'M5\n')).toHaveLength(1);
    expect(writes.filter((data) => data === 'M9\n')).toHaveLength(1);
    expect(writes).not.toContain('G1 X1234567893\n');
    expect(connection.closeCount()).toBe(1);
    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      streamer: null,
    });
  });

  it('does not resurrect stream ownership when onClose wins a pending refill rejection', async () => {
    const writes: string[] = [];
    let holdRefill = false;
    let pendingCaptured = false;
    let rejectPending: (reason?: unknown) => void = () => undefined;
    const behavior: ConnectionBehavior = {
      autoResetBanner: true,
      reject: () => false,
      beforeProtocol: (data) =>
        holdRefill && data === REFILL_LINE
          ? new Promise<void>((_resolve, reject) => {
              pendingCaptured = true;
              rejectPending = reject;
            })
          : Promise.resolve(),
    };
    const connection = makeConnection(writes, behavior);
    liveBehavior = behavior;
    await connectReady(connection);
    await useLaserStore
      .getState()
      .startJob('G1 X1234567890\nG1 X1234567891\nG1 X1234567892\nG1 X1234567893\n', {
        rxBufferBytes: 30,
      });
    writes.length = 0;
    holdRefill = true;

    connection.emitLine('ok');
    await flush();
    expect(pendingCaptured).toBe(true);
    connection.emitClose();
    rejectPending(new Error('late refill rejection'));
    await flush();

    expect(connection.resetSnapshots).toEqual([]);
    expect(writes).not.toContain(SOFT_RESET);
    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      streamer: { status: 'disconnected' },
      safetyNotice: { kind: 'disconnect-during-job' },
    });
  });

  it('quarantines a rejected tool-change Continue refill through the same reset path', async () => {
    const writes: string[] = [];
    let rejectContinue = false;
    const behavior: ConnectionBehavior = {
      autoResetBanner: true,
      reject: (data) => rejectContinue && data.includes('M3 S12000'),
    };
    const connection = makeConnection(writes, behavior);
    liveBehavior = behavior;
    await connectReady(connection);
    const gcode = [
      'G1 X1 Y1 F600',
      'G0 Z5',
      'M5',
      'G0 X0 Y0',
      `${TOOL_CHANGE_LOAD_PREFIX}6.35 mm end mill`,
      'M0',
      'G0 Z5',
      'M3 S12000',
      'G1 X2 Y2',
      'M5',
    ].join('\n');
    await useLaserStore.getState().startJob(gcode, {
      machineKind: 'cnc',
      cncToolPlan: [
        { id: 'em-3175', name: '3.175 mm end mill' },
        { id: 'em-6350', name: '6.35 mm end mill' },
      ],
      cncSetupAttestation: createCncSetupAttestation(
        gcode,
        cncControllerEpochOf(useLaserStore.getState()),
      ),
    });
    while ((useLaserStore.getState().streamer?.inFlight.length ?? 0) > 0) {
      connection.emitLine('ok');
      await flush();
    }
    connection.emitLine(IDLE);
    useLaserStore.setState({
      workZZeroEvidence: {
        source: 'manual-zero',
        referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
        toolId: 'em-6350',
      },
    });
    writes.length = 0;
    rejectContinue = true;

    await expect(useLaserStore.getState().continueToolChange()).rejects.toThrow(
      'job transport rejected',
    );
    await flush();

    expect(connection.resetSnapshots).toEqual([{ status: 'cancelled', inFlight: 0, queued: 0 }]);
    expect(writes.filter((data) => data === SOFT_RESET)).toHaveLength(1);
    expect(writes.filter((data) => data === 'M5\n')).toHaveLength(1);
    expect(writes.filter((data) => data === 'M9\n')).toHaveLength(1);
    await vi.waitFor(() => expect(connection.closeCount()).toBe(1));
    expect(connection.closeCount()).toBe(1);
    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      safetyNotice: { kind: 'write-failed', action: 'resume' },
    });
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
  });
});

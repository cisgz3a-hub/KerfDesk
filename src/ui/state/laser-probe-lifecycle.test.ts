import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCornerProbeLines,
  buildZProbeLines,
  DEFAULT_PLATE_CENTER_OFFSET_X_MM,
  DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
  DEFAULT_SIDE_CLEARANCE_MM,
} from '../../core/controllers/grbl';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
  readonly listenerCount: () => number;
};

const Z_REQUEST = {
  kind: 'z',
  params: {
    plateThicknessMm: 15,
    seekFeedMmPerMin: 150,
    probeFeedMmPerMin: 25,
    maxTravelMm: 25,
    retractMm: 5,
  },
} satisfies ProbeRequest;

const CORNER_REQUEST = {
  kind: 'corner',
  params: {
    ...Z_REQUEST.params,
    bitDiameterMm: 6.35,
    toolKind: 'end-mill',
    corner: 'front-left',
    plateCenterOffsetXmm: DEFAULT_PLATE_CENTER_OFFSET_X_MM,
    plateCenterOffsetYmm: DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
    sideDropMm: 3,
    sideClearanceMm: DEFAULT_SIDE_CLEARANCE_MM,
  },
} satisfies ProbeRequest;

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      if (
        data === '$I\n' &&
        useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
      ) {
        emit('[VER:1.1h.20190830:test]');
        emit('[OPT:VM,15,128]');
        emit('ok');
      }
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => undefined,
    emitLine: emit,
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
    listenerCount: () => lineHandlers.size,
  };
}

function makeAdapter(connection: SerialConnection): PlatformAdapter {
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

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 48; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  if (useLaserStore.getState().connection.kind !== 'disconnected') {
    await useLaserStore.getState().disconnect();
  }
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastWriteError: null,
    safetyNotice: null,
    probeBusy: false,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    pendingUntrackedAcks: 0,
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroEvidence: null,
    workZReferenceEpoch: 0,
    wcoCache: null,
    frameVerification: null,
    log: [],
  });
  vi.restoreAllMocks();
});

describe('probe controller transaction lifecycle', () => {
  it('owns every ack and proves settlement before establishing Z evidence', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const probeEpoch = useLaserStore.getState().workZReferenceEpoch + 1;
    const probe = useLaserStore.getState().probe(Z_REQUEST);
    await flush();
    expect(writes).toEqual(['M5\n']);
    expect(connection.listenerCount()).toBe(1);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    await expect(useLaserStore.getState().sendConsoleCommand('$I')).rejects.toThrow(
      /controller operation/i,
    );
    await expect(startTestLaserJob('G21\nG90\nM5\n')).rejects.toThrow(/controller operation/i);
    await expect(useLaserStore.getState().sendRealtimeOverride('\x90')).rejects.toThrow(
      /locked during a probe/i,
    );

    const expectedSequence = ['M5', 'M9', ...buildZProbeLines(Z_REQUEST.params), 'G4 P0.01'];
    for (let index = 0; index < expectedSequence.length; index += 1) {
      expect(writes[index]).toBe(`${expectedSequence[index]}\n`);
      connection.emitLine('ok');
      await flush();
    }
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'probe',
      phase: 'awaiting-idle',
    });
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();

    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0>');
    await expect(probe).resolves.toEqual({ kind: 'ok' });
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toMatchObject({
      source: 'probe',
      referenceEpoch: probeEpoch,
      probePlateRemoved: false,
    });
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('captures replies delivered synchronously before write resolves', async () => {
    const writes: string[] = [];
    let autoAck = false;
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (autoAck && data.endsWith('\n')) connection.emitLine('ok');
    });
    await connectWith(connection);
    writes.length = 0;
    autoAck = true;

    const probe = useLaserStore.getState().probe(Z_REQUEST);
    for (let i = 0; i < 400; i += 1) {
      const operation = useLaserStore.getState().controllerOperation;
      if (
        writes.at(-1) === 'G4 P0.01\n' &&
        operation?.kind === 'probe' &&
        operation.phase === 'awaiting-idle'
      )
        break;
      await Promise.resolve();
    }
    expect(writes.at(-1)).toBe('G4 P0.01\n');
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'probe',
      phase: 'awaiting-idle',
    });
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);

    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0>');
    await expect(probe).resolves.toEqual({ kind: 'ok' });
  });

  it('rejects an invalid structural request without establishing evidence', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const result = await useLaserStore.getState().probe({ kind: 'z' } as unknown as ProbeRequest);
    expect(result).toMatchObject({ kind: 'preflight-failed' });
    expect(writes).toEqual([]);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
  });

  it('does not write a partial corner WCS when the final side contact fails', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const lines = ['M5', 'M9', ...buildCornerProbeLines(CORNER_REQUEST.params)];
    const lastProbeLine = lines.filter((line) => line.startsWith('G38.2')).at(-1);
    if (lastProbeLine === undefined) throw new Error('corner probe line missing');

    const probe = useLaserStore.getState().probe(CORNER_REQUEST);
    await flush();
    for (const line of lines) {
      expect(writes.at(-1)).toBe(`${line}\n`);
      if (line === lastProbeLine) {
        connection.emitLine('ALARM:5');
        break;
      }
      connection.emitLine('ok');
      await flush();
    }

    await expect(probe).resolves.toEqual({ kind: 'probe-failed', alarmCode: 5 });
    expect(writes.some((line) => line.startsWith('G10 L20'))).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  });

  it('aborts on a status-only Alarm even when no numbered ALARM line arrives', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({
      workZZeroEvidence: {
        source: 'manual-zero',
        referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
      },
    });

    const probe = useLaserStore.getState().probe(Z_REQUEST);
    await flush();
    connection.emitLine('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');

    await expect(probe).resolves.toEqual({ kind: 'alarm', alarmCode: null });
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
  });

  it('preserves XY evidence during a Z probe but invalidates it on a global alarm', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g54-persistent',
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0 },
      wcoCache: { x: 1, y: 2, z: 3 },
      frameVerification: {
        boundsSignature: 'bounds',
        wco: { x: 1, y: 2, z: 3 },
        workOriginActive: true,
      },
    });

    const probe = useLaserStore.getState().probe(Z_REQUEST);
    await flush();
    expect(useLaserStore.getState()).toMatchObject({
      wcoCache: { x: 1, y: 2, z: 3 },
      frameVerification: { boundsSignature: 'bounds' },
    });
    connection.emitLine('ALARM:5');
    await expect(probe).resolves.toEqual({ kind: 'probe-failed', alarmCode: 5 });
    expect(useLaserStore.getState()).toMatchObject({
      probeBusy: false,
      controllerOperation: null,
      alarmCode: 5,
      workZZeroEvidence: null,
      wcoCache: null,
      frameVerification: null,
    });
  });

  it('soft-resets after timeout and keeps Start locked until two fresh Idle reports', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let releaseReset!: () => void;
    const resetAccepted = new Promise<void>((resolve) => {
      releaseReset = resolve;
    });
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === '\x18') await resetAccepted;
    });
    await connectWith(connection);
    writes.length = 0;

    const probe = useLaserStore.getState().probe(Z_REQUEST);
    await flush();
    await vi.advanceTimersByTimeAsync(45_001);
    await flush();
    expect(writes).toContain('\x18');
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'probe',
      phase: 'recovering',
    });
    expect(useLaserStore.getState().probeBusy).toBe(true);
    await expect(startTestLaserJob('G21\nG90\nM5\n')).rejects.toThrow(/controller operation/i);

    // Idle reports received before reset transport acceptance are stale and
    // cannot satisfy the recovery proof.
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().probeBusy).toBe(true);
    releaseReset();
    await flush();
    // Even post-write Idle is not enough; the controller must first prove it
    // processed reset by emitting its reboot banner.
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().probeBusy).toBe(true);
    connection.emitLine('Grbl 1.1f');
    await flush();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().probeBusy).toBe(true);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await expect(probe).resolves.toMatchObject({ kind: 'timeout' });
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
  });

  it('clears probe busy when the physical port closes', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    const probe = useLaserStore.getState().probe(Z_REQUEST);
    await flush();
    connection.emitClose();

    await expect(probe).resolves.toMatchObject({ kind: 'preflight-failed' });
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
  });

  it('treats an early reboot banner as transaction loss instead of a response', async () => {
    let releaseWrite!: () => void;
    let holdProbeWrite = false;
    const heldWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const connection = makeConnection(async (data) => {
      if (holdProbeWrite && data === 'M5\n') await heldWrite;
    });
    await connectWith(connection);
    holdProbeWrite = true;

    const probe = useLaserStore.getState().probe(Z_REQUEST);
    await flush();
    connection.emitLine('Grbl 1.1f');
    await expect(probe).resolves.toMatchObject({ kind: 'preflight-failed' });
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
    releaseWrite();
    await flush();
  });
});

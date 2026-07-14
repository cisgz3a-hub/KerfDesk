import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCornerProbeLines,
  DEFAULT_PLATE_CENTER_OFFSET_X_MM,
  DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
  DEFAULT_SIDE_CLEARANCE_MM,
  DEFAULT_SIDE_DROP_MM,
  DEFAULT_Z_PROBE_PARAMS,
  type ProbeRequest,
} from '../../core/controllers/grbl/probe';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

const CORNER_REQUEST = {
  kind: 'corner',
  params: {
    ...DEFAULT_Z_PROBE_PARAMS,
    bitDiameterMm: 6.35,
    toolKind: 'end-mill',
    corner: 'front-left',
    plateCenterOffsetXmm: DEFAULT_PLATE_CENTER_OFFSET_X_MM,
    plateCenterOffsetYmm: DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
    sideDropMm: DEFAULT_SIDE_DROP_MM,
    sideClearanceMm: DEFAULT_SIDE_CLEARANCE_MM,
  },
} satisfies ProbeRequest;

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  return {
    write,
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
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

async function flush(): Promise<void> {
  for (let index = 0; index < 48; index += 1) await Promise.resolve();
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

function expectCornerEvidenceInvalid(): void {
  expect(useLaserStore.getState()).toMatchObject({
    workOriginActive: true,
    workOriginSource: 'unknown',
    workZZeroEvidence: null,
    wcoCache: null,
    frameVerification: null,
  });
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
    wcoCache: null,
    frameVerification: null,
    log: [],
  });
  vi.restoreAllMocks();
});

describe('atomic corner-probe controller transaction', () => {
  it('writes no controller bytes when static plate and cutter geometry is unsafe', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const result = await useLaserStore.getState().probe({
      ...CORNER_REQUEST,
      params: { ...CORNER_REQUEST.params, bitDiameterMm: 100 },
    });

    expect(result).toMatchObject({
      kind: 'preflight-failed',
      reason: expect.stringContaining('plate center offsets'),
    });
    expect(writes).toEqual([]);
    expect(useLaserStore.getState()).toMatchObject({
      probeBusy: false,
      controllerOperation: null,
    });
  });

  it.each([
    [{ toolKind: 'v-bit' as const }, 'cylindrical end mill'],
    [{ sideDropMm: 0.0001 }, '0.001 mm precision'],
    [{ sideClearanceMm: 1e20 }, 'at most 100 mm'],
  ])('writes no bytes for unsupported runtime parameters %#', async (patch, reason) => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const result = await useLaserStore.getState().probe({
      ...CORNER_REQUEST,
      params: { ...CORNER_REQUEST.params, ...patch },
    });

    expect(result).toMatchObject({
      kind: 'preflight-failed',
      reason: expect.stringContaining(reason),
    });
    expect(writes).toEqual([]);
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'does not write a partial WCS when probe contact %i fails',
    async (failedProbeIndex) => {
      const writes: string[] = [];
      const connection = makeConnection(async (data) => {
        writes.push(data);
      });
      await connectWith(connection);
      writes.length = 0;

      const lines = buildCornerProbeLines(CORNER_REQUEST.params);
      const probe = useLaserStore.getState().probe(CORNER_REQUEST);
      await flush();
      let probeIndex = 0;
      for (const line of ['M5', 'M9', ...lines]) {
        expect(writes.at(-1)).toBe(`${line}\n`);
        if (line.startsWith('G38.2') && probeIndex === failedProbeIndex) {
          connection.emitLine('ALARM:5');
          break;
        }
        if (line.startsWith('G38.2')) probeIndex += 1;
        connection.emitLine('ok');
        await flush();
      }

      await expect(probe).resolves.toEqual({ kind: 'probe-failed', alarmCode: 5 });
      expect(writes.some((line) => line.startsWith('G10 L20'))).toBe(false);
      expectCornerEvidenceInvalid();
    },
  );

  it.each(['combined G10', 'final park'] as const)(
    'keeps coordinate evidence invalid when an alarm occurs at the %s boundary',
    async (failureBoundary) => {
      const writes: string[] = [];
      const connection = makeConnection(async (data) => {
        writes.push(data);
      });
      await connectWith(connection);
      writes.length = 0;

      const lines = buildCornerProbeLines(CORNER_REQUEST.params);
      const commitLine = lines.find((line) => line.startsWith('G10 L20'));
      if (commitLine === undefined) throw new Error('corner commit line missing');
      const parkLine = lines.at(-1);
      if (parkLine === undefined) throw new Error('corner park line missing');

      const probe = useLaserStore.getState().probe(CORNER_REQUEST);
      await flush();
      const failureLine = failureBoundary === 'combined G10' ? commitLine : parkLine;
      for (const line of ['M5', 'M9', ...lines]) {
        expect(writes.at(-1)).toBe(`${line}\n`);
        if (line === failureLine) {
          connection.emitLine('ALARM:1');
          break;
        }
        connection.emitLine('ok');
        await flush();
      }

      await expect(probe).resolves.toEqual({ kind: 'alarm', alarmCode: 1 });
      expect(writes).toContain(`${commitLine}\n`);
      expect(useLaserStore.getState()).toMatchObject({
        probeBusy: false,
        controllerOperation: null,
      });
      expectCornerEvidenceInvalid();
    },
  );

  it('treats a combined G10 acknowledgement timeout as coordinate-uncertain', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const lines = buildCornerProbeLines(CORNER_REQUEST.params);
    const commitLine = lines.find((line) => line.startsWith('G10 L20'));
    if (commitLine === undefined) throw new Error('corner commit line missing');

    const probe = useLaserStore.getState().probe(CORNER_REQUEST);
    await flush();
    for (const line of ['M5', 'M9', ...lines]) {
      expect(writes.at(-1)).toBe(`${line}\n`);
      if (line === commitLine) break;
      connection.emitLine('ok');
      await flush();
    }

    await vi.advanceTimersByTimeAsync(45_001);
    await flush();
    expect(writes).toContain('\x18');
    expect(useLaserStore.getState()).toMatchObject({ probeBusy: true });
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'probe',
      phase: 'recovering',
    });
    expectCornerEvidenceInvalid();

    connection.emitLine('Grbl 1.1f');
    await flush();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await expect(probe).resolves.toEqual({ kind: 'timeout', pendingLine: commitLine });
    expect(useLaserStore.getState()).toMatchObject({
      probeBusy: false,
      controllerOperation: null,
    });
    expectCornerEvidenceInvalid();
  });
});

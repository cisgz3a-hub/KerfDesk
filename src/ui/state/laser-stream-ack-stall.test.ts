import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { captureTestLaserStartFenceAck, startTestLaserJob } from './laser-test-start-helpers';
import { STREAM_HOLD_NOTICE_MS } from './laser-stream-hold';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
  readonly closeCount: () => number;
};

let liveConnection: FakeConnection | null = null;
type ConnectionOptions = {
  readonly autoResetBanner?: boolean;
  readonly marlin?: boolean;
  readonly resetWrite?: 'accepted' | 'rejected' | 'hung';
};

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

async function simulateResetWrite(
  data: string,
  options: ConnectionOptions,
  emitLine: (line: string) => void,
): Promise<void> {
  if (data !== '\x18') return;
  if (options.resetWrite === 'rejected') throw new Error('Reset rejected.');
  if (options.resetWrite === 'hung') await new Promise<void>(() => undefined);
  if (options.autoResetBanner !== false) setTimeout(() => emitLine('Grbl 1.1f'), 0);
}

function makeConnection(writes: string[], options: ConnectionOptions = {}): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  let closes = 0;
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  const connection: FakeConnection = {
    write: async (data) => {
      const acknowledgeStartFence = captureTestLaserStartFenceAck(data, emitLine);
      writes.push(data);
      await simulateResetWrite(data, options, emitLine);
      if (data === '?') emitLine('<Idle|MPos:0,0,0|FS:0,0>');
      if (data === 'M114\n') {
        emitLine('X:0.00 Y:0.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0');
        emitLine('ok');
      }
      if (data === '$I\n') {
        emitLine('[VER:1.1h.20190830:test]');
        emitLine('[OPT:VM,15,128]');
        emitLine('ok');
      }
      if (data === '$G\n') {
        emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emitLine('ok');
      }
      if (data === '$$\n') {
        emitLine('$30=1000');
        emitLine('$31=0');
        emitLine('$32=1');
        emitLine('ok');
      }
      if (
        data === 'M5\n' ||
        data === 'M9\n' ||
        data === 'M107\n' ||
        data === 'M410\n' ||
        data === 'M5 I\n'
      )
        emitLine('ok');
      acknowledgeStartFence();
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
      closes++;
    },
    emitLine,
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
    closeCount: () => closes,
  };
  liveConnection = connection;
  return connection;
}

async function connectReady(connection: FakeConnection, marlin = false): Promise<void> {
  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
  await useLaserStore
    .getState()
    .connect(adapter, { controllerKind: marlin ? 'marlin' : 'grbl-v1.1' });
  connection.emitLine(marlin ? 'start' : 'Grbl 1.1f');
  connection.emitLine(
    marlin ? 'X:0.00 Y:0.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0' : '<Idle|MPos:0,0,0|FS:0,0>',
  );
  await flush();
  await vi.advanceTimersByTimeAsync(100);
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
}

const JOB = [
  'G21',
  'G90',
  'M4 S0',
  ...Array.from({ length: 30 }, (_, i) => `G1 X${i} S100`),
  'M5',
].join('\n');

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  liveConnection?.emitClose();
  liveConnection = null;
  await flush();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('acknowledgement stall containment', () => {
  it('resets and recovers on the responsive connection instead of only claiming the sender stopped', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectReady(connection);
    await startTestLaserJob(JOB);
    writes.length = 0;

    await vi.advanceTimersByTimeAsync(STREAM_HOLD_NOTICE_MS + 1_000);
    await flush();

    expect(writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(writes).toContain('M5\n');
    expect(writes).toContain('M9\n');
    expect(writes.some((payload) => payload.includes('G1 X'))).toBe(false);
    expect(connection.closeCount()).toBe(0);
    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'connected' },
      streamer: { status: 'cancelled' },
      controllerOperation: null,
      controllerQualification: { kind: 'qualified' },
      pendingUntrackedAcks: 0,
      pendingTransportWrites: 0,
      safetyNotice: { kind: 'stream-stalled' },
    });
    expect(useLaserStore.getState().safetyNotice?.message).toContain('existing connection');

    connection.emitLine('ok');
    await flush();
    expect(writes.some((payload) => payload.includes('G1 X'))).toBe(false);
  });

  it('allows a healthy 120-second programmed dwell beyond the hold deadline and contains only after its margin expires', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectReady(connection);
    await startTestLaserJob('G4 P120\nG1 X1 S100\nM5');
    writes.length = 0;
    await vi.advanceTimersByTimeAsync(100_000);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(useLaserStore.getState().streamHold?.dwellSeconds).toBe(120);
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(writes).not.toContain('\x18');
    expect(writes.some((line) => line.includes('G1 X'))).toBe(false);
    await vi.advanceTimersByTimeAsync(23_000);
    expect(writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('stream-stalled');
    expect(connection.closeCount()).toBe(0);
  });

  it('freezes late acknowledgements and joins one reset when Disconnect overlaps recovery', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes, { autoResetBanner: false });
    await connectReady(connection);
    await startTestLaserJob(JOB);
    writes.length = 0;

    await vi.advanceTimersByTimeAsync(STREAM_HOLD_NOTICE_MS + 200);
    await flush();
    expect(writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(useLaserStore.getState().controllerOperation).toMatchObject({ kind: 'recovery' });
    connection.emitLine('ok');
    await flush();
    expect(writes.some((payload) => payload.includes('G1 X'))).toBe(false);

    const disconnect = useLaserStore.getState().disconnect();
    connection.emitLine('Grbl 1.1f');
    await vi.advanceTimersByTimeAsync(0);
    await disconnect;

    expect(writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(writes.filter((line) => line === 'M5\n')).toHaveLength(1);
    expect(writes.filter((line) => line === 'M9\n')).toHaveLength(1);
    expect(connection.closeCount()).toBe(1);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
  });

  it.each(['accepted', 'rejected', 'hung'] as const)(
    'retains a stalled sender after an unconfirmed %s reset and recovers only at a late boot',
    async (resetWrite) => {
      const writes: string[] = [];
      const connection = makeConnection(writes, { autoResetBanner: false, resetWrite });
      await connectReady(connection);
      await startTestLaserJob(JOB);
      writes.length = 0;
      await vi.advanceTimersByTimeAsync(STREAM_HOLD_NOTICE_MS + 1_000);
      const owner = useLaserStore.getState().controllerOperation;
      expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
      expect(owner).toMatchObject({ kind: 'recovery', phase: 'reset' });
      expect(useLaserStore.getState().streamer?.inFlight.length).toBeGreaterThan(0);
      for (let index = 0; index < 40; index++) connection.emitLine('ok');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(0);
      expect(useLaserStore.getState().controllerOperation).toBe(owner);
      expect(writes.filter((line) => line === 'M5\n')).toHaveLength(1);
      expect(writes.filter((line) => line === 'M9\n')).toHaveLength(1);
      expect(writes).not.toContain('$$\n');
      expect(writes.some((line) => line.includes('G1 X'))).toBe(false);
      expect(connection.closeCount()).toBe(0);
      connection.emitLine('Grbl 1.1f');
      connection.emitLine('<Idle|MPos:0,0,0|FS:0,0>');
      await vi.advanceTimersByTimeAsync(250);
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
      expect(writes.filter((line) => line === '\x18')).toHaveLength(1);
      expect(writes.filter((line) => line === '$$\n')).toHaveLength(1);
      expect(connection.closeCount()).toBe(0);
    },
  );

  it('freezes a non-resettable sender before beam-off acknowledgements can refill it', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes, { marlin: true });
    await connectReady(connection, true);
    await startTestLaserJob(JOB, { streamingMode: 'ping-pong' });
    writes.length = 0;

    await vi.advanceTimersByTimeAsync(STREAM_HOLD_NOTICE_MS + 500);
    await flush();

    expect(writes).not.toContain('\x18');
    expect(writes).toContain('M5 I\n');
    expect(writes).toContain('M410\n');
    expect(writes).toContain('M107\n');
    expect(writes.some((payload) => payload.includes('G1 X'))).toBe(false);
    expect(connection.closeCount()).toBe(0);
    expect(useLaserStore.getState().safetyNotice?.message).toContain('no realtime reset');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    connection.emitLine('ok');
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();
    expect(writes.some((payload) => payload.includes('G1 X'))).toBe(false);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });
});

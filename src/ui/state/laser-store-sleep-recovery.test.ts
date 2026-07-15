import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

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
      requestPort: async () => ({
        open: async () => connection,
      }),
    },
  };
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  useLaserStore.setState({ autofocusBusy: false });
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    autofocusBusy: false,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    log: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    frameVerification: null,
  });
  vi.restoreAllMocks();
});

describe('laser-store Sleep recovery', () => {
  it('refuses soft reset before claiming recovery when no serial transport exists', async () => {
    await useLaserStore.getState().disconnect();
    useLaserStore.setState({
      connection: { kind: 'disconnected' },
      statusReport: null,
      safetyNotice: null,
      controllerOperation: null,
      lastWriteError: null,
    });

    await expect(useLaserStore.getState().wakeController()).rejects.toThrow(
      'Reconnect the controller before sending a soft reset',
    );

    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(useLaserStore.getState().lastWriteError).toContain('not connected');
  });

  it('wakes a sleeping controller with soft reset without disconnecting', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    useLaserStore.setState({
      statusReport: {
        state: 'Sleep',
        subState: null,
        mPos: { x: 12, y: 34, z: 0 },
        wPos: null,
        wco: null,
        feed: 0,
        spindle: 0,
      },
      alarmCode: 9,
      workOriginActive: true,
      wcoCache: { x: 12, y: 34, z: 0 },
      frameVerification: {
        boundsSignature: '0,0,10,10',
        wco: { x: 12, y: 34, z: 0 },
        workOriginActive: true,
      },
      homingState: 'confirmed',
      homingProof: {
        sessionEpoch: useLaserStore.getState().controllerSessionEpoch,
        positionEpoch: useLaserStore.getState().trustedPositionEpoch ?? 0,
        confirmedStatusSequence: useLaserStore.getState().statusSequence,
      },
      controllerSettings: { homingEnabled: true },
      controllerSettingsObservation: {
        sessionEpoch: useLaserStore.getState().controllerSessionEpoch,
        observedAt: 1,
      },
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const sessionEpoch = useLaserStore.getState().controllerSessionEpoch;

    const wake = useLaserStore.getState().wakeController();
    await flush();

    expect(write).toHaveBeenCalledWith('\x18');
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(useLaserStore.getState().statusReport).toBeNull();
    expect(useLaserStore.getState().controllerSessionEpoch).toBe(sessionEpoch + 1);
    expect(useLaserStore.getState().controllerSettings).toBeNull();
    expect(useLaserStore.getState().controllerSettingsObservation).toBeNull();
    expect(useLaserStore.getState().homingState).toBe('unknown');
    expect(useLaserStore.getState().homingProof).toBeNull();
    expect(useLaserStore.getState().alarmCode).toBeNull();
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'recovery',
      phase: 'awaiting-idle',
    });

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await wake;

    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });
});

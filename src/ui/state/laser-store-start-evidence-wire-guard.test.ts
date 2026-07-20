import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import type { SessionObservationStamp } from './laser-controller-observation';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

function makeConnection(writes: string[]): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      writes.push(data);
      if (
        data === '$I\n' &&
        (useLaserStore.getState().controllerOperation?.kind === 'connection-handshake' ||
          useLaserStore.getState().controllerOperation?.kind === 'interactive-command')
      ) {
        emit('[VER:1.1h.20190830:test]');
        emit('[OPT:VM,15,128]');
        emit('ok');
      }
      if (data === '$G\n') {
        emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emit('ok');
      }
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: emit,
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
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  await flush();
}

const JOB_LINE = 'G1 X99.000 Y99.000 F600 S255';
const JOB_GCODE = Array.from({ length: 8 }, () => JOB_LINE).join('\n');

async function beginFencedLaserStart(): Promise<{
  readonly connection: FakeConnection;
  readonly writes: string[];
  readonly started: Promise<void>;
  readonly sessionEpoch: number;
}> {
  const writes: string[] = [];
  const connection = makeConnection(writes);
  await connectWith(connection);
  const state = useLaserStore.getState();
  const settingsObservation: SessionObservationStamp = {
    sessionEpoch: state.controllerSessionEpoch,
    observedAt: 1,
  };
  useLaserStore.setState({
    controllerSettings: { maxPowerS: 1000, laserModeEnabled: true },
    controllerSettingsObservation: settingsObservation,
  });
  await useLaserStore.getState().sendConsoleCommand('G92 X0 Y0');
  writes.length = 0;
  const started = useLaserStore.getState().startJob(JOB_GCODE, {
    machineKind: 'laser',
    laserModeStartEvidence: {
      controllerSessionEpoch: state.controllerSessionEpoch,
      settingsCapability: state.capabilities.settings,
      settingsObservation,
      laserModeEnabled: true,
      maxPowerS: 1000,
      controllerBuildInfo: null,
      buildInfoObservation: null,
      expectedMaxPowerS: 1000,
      m7Required: false,
      unverifiedAcknowledged: false,
    },
  });
  await flush();
  return { connection, writes, started, sessionEpoch: state.controllerSessionEpoch };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

describe('laser Start evidence at the queue fence', () => {
  it('refuses missing review evidence before writing job bytes', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectWith(connection);
    writes.length = 0;

    const started = useLaserStore.getState().startJob(JOB_GCODE, { machineKind: 'laser' });

    await expect(started).rejects.toThrow(/requires reviewed controller evidence/i);
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(writes.some((write) => write.includes(JOB_LINE))).toBe(false);
  });

  it('does not hard-refuse a fresh $32=0 advisory before writing job bytes', async () => {
    const { connection, writes, started, sessionEpoch } = await beginFencedLaserStart();
    useLaserStore.setState({
      controllerSettings: { maxPowerS: 1000, laserModeEnabled: false },
      controllerSettingsObservation: { sessionEpoch, observedAt: 2 },
    });
    connection.emitLine('ok');

    await expect(started).resolves.toBeUndefined();
    expect(useLaserStore.getState().streamer).not.toBeNull();
    expect(writes.some((write) => write.includes(JOB_LINE))).toBe(true);
  });

  it('does not hard-refuse changed settings observations after review', async () => {
    const { connection, writes, started, sessionEpoch } = await beginFencedLaserStart();
    useLaserStore.setState({
      controllerSettings: { maxPowerS: 1000, laserModeEnabled: true },
      controllerSettingsObservation: { sessionEpoch, observedAt: 2 },
    });
    connection.emitLine('ok');

    await expect(started).resolves.toBeUndefined();
    expect(useLaserStore.getState().streamer).not.toBeNull();
    expect(writes.some((write) => write.includes(JOB_LINE))).toBe(true);
  });

  it('does not hard-refuse a fresh $30 mismatch before writing job bytes', async () => {
    const { connection, writes, started, sessionEpoch } = await beginFencedLaserStart();
    useLaserStore.setState({
      controllerSettings: { maxPowerS: 255, laserModeEnabled: true },
      controllerSettingsObservation: { sessionEpoch, observedAt: 2 },
    });
    connection.emitLine('ok');

    await expect(started).resolves.toBeUndefined();
    expect(useLaserStore.getState().streamer).not.toBeNull();
    expect(writes.some((write) => write.includes(JOB_LINE))).toBe(true);
  });
});

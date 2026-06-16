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
  await Promise.resolve();
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
    streamer: null,
    log: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
  });
  vi.restoreAllMocks();
});

describe('laser-store GRBL laser setup', () => {
  it('blocks GRBL laser setup until controller settings have been read', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await expect(useLaserStore.getState().configureGrblLaserSetup()).rejects.toThrow(
      /read machine settings/i,
    );

    expect(writes).toEqual([]);
  });

  it('sends the explicit Neotronics-safe GRBL laser setup sequence and refreshes $$ settings', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    seedSettingsRead(connection);
    writes.length = 0;

    await useLaserStore.getState().configureGrblLaserSetup();

    expect(writes).toEqual(['$32=1\n', '$30=1000\n', '$130=400\n', '$131=400\n', '$$\n']);
  });

  it('blocks GRBL laser setup while a job is active', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    seedSettingsRead(connection);
    writes.length = 0;
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    writes.length = 0;

    await expect(useLaserStore.getState().configureGrblLaserSetup()).rejects.toThrow(
      /job is active/i,
    );

    expect(writes).toEqual([]);
  });
});

function seedSettingsRead(connection: FakeConnection): void {
  connection.emitLine('$20=1');
  connection.emitLine('$21=1');
  connection.emitLine('$22=1');
  connection.emitLine('$23=3');
  connection.emitLine('$30=1000');
  connection.emitLine('$31=0');
  connection.emitLine('$32=1');
  connection.emitLine('$130=400');
  connection.emitLine('$131=400');
  connection.emitLine('$132=75');
  connection.emitLine('ok');
}

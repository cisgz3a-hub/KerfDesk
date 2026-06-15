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
      requestPort: async () => ({ open: async () => connection }),
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
    transcript: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
  });
  vi.restoreAllMocks();
});

describe('laser-store console commands', () => {
  it('records inbound and outbound controller traffic in the transcript', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.getState().clearTranscript();

    await useLaserStore.getState().sendConsoleCommand('$I');
    connection.emitLine('[VER:1.1f.20240101:]');

    expect(writes.at(-1)).toBe('$I\n');
    expect(useLaserStore.getState().transcript.map((entry) => entry.raw)).toEqual([
      '$I\n',
      '[VER:1.1f.20240101:]',
    ]);
    expect(useLaserStore.getState().transcript[0]).toMatchObject({
      direction: 'out',
      kind: 'build-info-query',
      source: 'console',
    });
  });

  it('refreshes detected settings when $$ is sent from the console', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({ detectedSettings: null, controllerSettings: null });

    await useLaserStore.getState().sendConsoleCommand('$$');
    for (const line of ['$30=1000', '$31=0', '$32=1', '$130=400', '$131=400', 'ok']) {
      connection.emitLine(line);
    }

    expect(writes.at(-1)).toBe('$$\n');
    expect(useLaserStore.getState().controllerSettings).toMatchObject({
      maxPowerS: 1000,
      minPowerS: 0,
      laserModeEnabled: true,
      bedWidth: 400,
      bedHeight: 400,
    });
  });

  it('blocks console commands during an active job except realtime status query', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    writes.length = 0;

    await expect(useLaserStore.getState().sendConsoleCommand('$I')).rejects.toThrow(
      /job is active/i,
    );
    await useLaserStore.getState().sendConsoleCommand('?');

    expect(writes).toEqual(['?']);
    expect(useLaserStore.getState().transcript.at(-1)).toMatchObject({
      raw: '?',
      source: 'console',
      kind: 'realtime',
    });
  });

  it('requires confirmation and Idle state for setting writes', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);

    await expect(useLaserStore.getState().sendConsoleCommand('$32=1')).rejects.toThrow(
      /confirmation/i,
    );
    await expect(
      useLaserStore.getState().sendConsoleCommand('$32=1', { confirmed: true }),
    ).rejects.toThrow(/Idle status report/i);

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await useLaserStore.getState().sendConsoleCommand('$32=1', { confirmed: true });

    expect(writes.at(-1)).toBe('$32=1\n');
  });
});

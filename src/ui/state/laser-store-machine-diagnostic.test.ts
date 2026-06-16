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
  connection.emitLine('$30=1000');
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    streamer: null,
    log: [],
    transcript: [],
    safetyNotice: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  });
  vi.restoreAllMocks();
});

describe('laser-store machine diagnostic', () => {
  it('supersedes a stale settings collector from an incomplete connect-time probe', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await useLaserStore.getState().connect(makeAdapter(connection));
    connection.emitLine('Grbl 1.1f');
    await Promise.resolve();
    writes.length = 0;

    await useLaserStore.getState().runMachineDiagnostic();

    expect(writes).toEqual(['$I\n', '$$\n', '$#\n', '$G\n', '?']);
  });

  it('clears a failed diagnostic collector so the operator can retry', async () => {
    const writes: string[] = [];
    let failWrites = false;
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (failWrites) throw new Error('port hiccup');
    });
    await connectWith(connection);
    writes.length = 0;
    failWrites = true;

    await expect(useLaserStore.getState().runMachineDiagnostic()).rejects.toThrow('port hiccup');
    failWrites = false;

    await useLaserStore.getState().runMachineDiagnostic();

    expect(writes.slice(-5)).toEqual(['$I\n', '$$\n', '$#\n', '$G\n', '?']);
  });

  it('does not record failed diagnostic writes as delivered outbound evidence', async () => {
    let failWrites = false;
    const connection = makeConnection(async () => {
      if (failWrites) throw new Error('port hiccup');
    });
    await connectWith(connection);
    useLaserStore.setState({ transcript: [] });
    failWrites = true;

    await expect(useLaserStore.getState().runMachineDiagnostic()).rejects.toThrow('port hiccup');

    expect(useLaserStore.getState().lastWriteError).toBe('port hiccup');
    expect(useLaserStore.getState().transcript).toEqual([]);
  });

  it('runs the read-only diagnostic probe sequence', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await useLaserStore.getState().runMachineDiagnostic();

    expect(writes).toEqual(['$I\n', '$$\n', '$#\n', '$G\n', '?']);
    expect(
      useLaserStore
        .getState()
        .transcript.map((entry) => entry.kind)
        .slice(-5),
    ).toEqual([
      'build-info-query',
      'settings-query',
      'offset-query',
      'modal-state-query',
      'realtime',
    ]);
  });

  it('uses the settings collector during the diagnostic $$ probe', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await useLaserStore.getState().runMachineDiagnostic();
    connection.emitLine('$30=1000');
    connection.emitLine('$32=1');
    connection.emitLine('ok');

    expect(useLaserStore.getState().controllerSettings).toEqual(
      expect.objectContaining({ maxPowerS: 1000, laserModeEnabled: true }),
    );
    expect(useLaserStore.getState().grblSettingsRows).toEqual([
      expect.objectContaining({ code: '$30', rawValue: '1000' }),
      expect.objectContaining({ code: '$32', rawValue: '1' }),
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
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
  // Several microtask hops before the handshake's $$ write lands and starts
  // the collector — flush fully so the dump below closes it and settles the
  // write's owed ack (startJob gates on the drain).
  await flush();
  connection.emitLine('$30=900');
  connection.emitLine('ok');
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
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
    transcript: [],
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    wcoCache: null,
    workOriginActive: false,
  });
  vi.restoreAllMocks();
});

describe('laser-store machine settings', () => {
  it('reads machine settings through the guarded serial write path', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const read = useLaserStore.getState().readMachineSettings();
    await flush();

    expect(writes.at(-1)).toBe('$$\n');
    expect(useLaserStore.getState().transcript.at(-1)).toMatchObject({
      direction: 'out',
      source: 'console',
      kind: 'settings-query',
    });
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'interactive-command',
      label: 'Reading controller settings',
    });

    connection.emitLine('ok');
    await read;

    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('populates known and unknown settings rows when the $$ dump completes', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);

    const read = useLaserStore.getState().readMachineSettings();
    await flush();
    for (const line of ['$30=1000', '$32=1', '$999=custom', 'ok']) {
      connection.emitLine(line);
    }
    await read;

    expect(useLaserStore.getState().grblSettingsRows).toEqual([
      expect.objectContaining({ code: '$30', known: true }),
      expect.objectContaining({ code: '$32', known: true }),
      expect.objectContaining({ code: '$999', known: false, rawValue: 'custom' }),
    ]);
    expect(useLaserStore.getState().lastSettingsReadAt).toEqual(expect.any(Number));
  });

  it('blocks read while a job is active', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');

    await expect(useLaserStore.getState().readMachineSettings()).rejects.toThrow(/job is active/i);
  });

  it('clears machine settings rows on disconnect', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({
      grblSettingsRows: [expect.objectContaining({ code: '$30' })],
      lastSettingsReadAt: 1,
    });

    await useLaserStore.getState().disconnect();

    expect(useLaserStore.getState().grblSettingsRows).toEqual([]);
    expect(useLaserStore.getState().lastSettingsReadAt).toBeNull();
  });

  it('writes one guarded common GRBL setting and re-reads $$', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({
      statusReport: idleStatus(),
      grblSettingsRows: settingsMapToRows(new Map([[30, '900']])),
      lastSettingsReadAt: Date.now(),
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    writes.length = 0;

    const write = useLaserStore.getState().writeGrblSetting(30, '1000');
    await flush();

    expect(writes).toEqual(['$30=1000\n']);
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'interactive-command',
      label: 'Writing $30',
    });

    connection.emitLine('ok');
    await flush();

    expect(writes).toEqual(['$30=1000\n', '$$\n']);
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'interactive-command',
      label: 'Verifying $30',
    });

    connection.emitLine('$30=1000');
    connection.emitLine('ok');
    await write;

    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('blocks guarded writes without a current settings backup', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({
      statusReport: idleStatus(),
      grblSettingsRows: [],
      lastSettingsReadAt: null,
    });

    await expect(useLaserStore.getState().writeGrblSetting(30, '1000')).rejects.toThrow(
      /read and export/i,
    );
  });

  it('blocks guarded writes for unknown controller settings', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({
      statusReport: idleStatus(),
      grblSettingsRows: settingsMapToRows(new Map([[999, 'custom']])),
      lastSettingsReadAt: Date.now(),
    } as Partial<ReturnType<typeof useLaserStore.getState>>);

    await expect(useLaserStore.getState().writeGrblSetting(999, '1')).rejects.toThrow(/unknown/i);
  });
});

function idleStatus(): ReturnType<typeof useLaserStore.getState>['statusReport'] {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    wco: null,
    feed: 0,
    spindle: 0,
  };
}

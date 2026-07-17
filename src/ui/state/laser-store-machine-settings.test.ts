import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useStore } from './store';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      // Real GRBL answers the connect-time $G modal query (C6) with its state
      // then ok; model it so the modal query settles during connect.
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
    emitLine: (line) => emit(line),
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
  // Several microtask hops before the handshake's $$ write lands and starts
  // the collector — flush fully so the dump below closes it and settles the
  // write's owed ack (startJob gates on the drain).
  await flush();
  connection.emitLine('$30=900');
  connection.emitLine('ok');
  // Let the detached handshake issue its post-qualification $G (C6) and the
  // fake connection auto-reply settle before the test drives more I/O.
  await flush();
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useStore.setState((state) => ({
    project: { ...state.project, machine: LASER_MACHINE_CONFIG },
  }));
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

  it('re-reads the active WCS once a post-reset settings re-qualification completes (C6)', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);

    // Mid-session the operator selects G55; the controller then reboots and
    // reverts to its own startup modal state, so the cached selection is stale
    // the moment the banner lands.
    useLaserStore.setState({ activeWcs: 'G55' });
    connection.emitLine('Grbl 1.1f');
    await flush();
    expect(useLaserStore.getState().activeWcs).toBeNull();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    writes.length = 0;

    // The post-reset re-qualification action (refs.runControllerQualification).
    const read = useLaserStore.getState().readMachineSettings();
    await flush();
    connection.emitLine('$30=900');
    connection.emitLine('ok');
    await read;
    await flush();

    // Re-qualification re-issues the modal query; the fake connection's
    // [GC:...G54...] auto-reply re-seeds the advisory without stranding the fence.
    expect(writes).toContain('$G\n');
    expect(useLaserStore.getState().activeWcs).toBe('G54');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('does not let an earlier console acknowledgement terminate a new settings read', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await useLaserStore.getState().sendConsoleCommand('$I');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    await expect(useLaserStore.getState().readMachineSettings()).rejects.toThrow(
      /previous controller write and acknowledgement/i,
    );
    expect(writes).toEqual(['$I\n']);

    connection.emitLine('ok');
    const read = useLaserStore.getState().readMachineSettings();
    await flush();
    connection.emitLine('$30=1000');
    connection.emitLine('$32=1');
    connection.emitLine('ok');
    await read;

    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
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

  it('blocks $32=0 at the serial write boundary for the active laser setup', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.setState((state) => ({
      project: { ...state.project, machine: LASER_MACHINE_CONFIG },
    }));
    useLaserStore.setState({
      statusReport: idleStatus(),
      grblSettingsRows: settingsMapToRows(new Map([[32, '1']])),
      lastSettingsReadAt: Date.now(),
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    writes.length = 0;

    await expect(useLaserStore.getState().writeGrblSetting(32, '0')).rejects.toThrow(
      /laser machine setup cannot write \$32=0/i,
    );
    expect(writes).toEqual([]);
  });

  it('retains $32=0 firmware writes for the active CNC setup', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    useLaserStore.setState({
      statusReport: idleStatus(),
      grblSettingsRows: settingsMapToRows(new Map([[32, '1']])),
      lastSettingsReadAt: Date.now(),
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    writes.length = 0;

    const write = useLaserStore.getState().writeGrblSetting(32, '0');
    await flush();
    expect(writes).toEqual(['$32=0\n']);

    connection.emitLine('ok');
    await flush();
    connection.emitLine('$32=0');
    connection.emitLine('ok');
    await write;
  });

  it('applies the same laser/CNC $32 policy to confirmed Console setting writes', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({ statusReport: idleStatus() });
    writes.length = 0;

    await expect(
      useLaserStore.getState().sendConsoleCommand('$32=0', { confirmed: true }),
    ).rejects.toThrow(/laser machine setup cannot write \$32=0/i);
    expect(writes).toEqual([]);

    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    await useLaserStore.getState().sendConsoleCommand('$32=0', { confirmed: true });
    expect(writes).toEqual(['$32=0\n']);
  });

  it('rejects every non-canonical laser $32 Console value before serial write', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({ statusReport: idleStatus() });
    writes.length = 0;

    for (const command of ['$32=0.5', '$32=.5', '$32=1.0', '$32=2', '$32=256']) {
      await expect(
        useLaserStore.getState().sendConsoleCommand(command, { confirmed: true }),
      ).rejects.toThrow(/laser machine setup cannot write \$32=0/i);
    }
    expect(writes).toEqual([]);
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import { LASER_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

type FakeConnectionControls = {
  autoModalReply: boolean;
};

function makeConnection(
  write: (data: string) => Promise<void>,
  controls: FakeConnectionControls = { autoModalReply: true },
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      if (data === '$G\n' && controls.autoModalReply) {
        emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emit('ok');
      }
      if (
        data === '$I\n' &&
        (useLaserStore.getState().controllerOperation?.kind === 'connection-handshake' ||
          useLaserStore.getState().controllerOperation?.kind === 'interactive-command')
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
  await flush();
  connection.emitLine('$30=900');
  connection.emitLine('ok');
  await flush();
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useStore.setState((state) => ({
    project: { ...state.project, machine: LASER_MACHINE_CONFIG },
  }));
});

afterEach(async () => {
  vi.clearAllTimers();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    controllerOperation: null,
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  });
  vi.restoreAllMocks();
});

describe('machine settings from Alarm', () => {
  it('completes the read-only settings query and preserves Alarm state', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    const read = useLaserStore.getState().readMachineSettings();
    await flush();
    expect(writes).toEqual(['$$\n']);
    connection.emitLine('$30=900');
    connection.emitLine('$32=1');
    connection.emitLine('ok');
    await read;

    expect(useLaserStore.getState().grblSettingsRows).toEqual(
      settingsMapToRows(
        new Map([
          [30, '900'],
          [32, '1'],
        ]),
      ),
    );
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
  });

  it('pauses the fast Alarm poll while the settings workflow owns the controller', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    const read = useLaserStore.getState().readMachineSettings();
    await flush();
    expect(writes).toEqual(['$$\n']);
    await vi.advanceTimersByTimeAsync(250);
    expect(writes).toEqual(['$$\n']);

    connection.emitLine('$30=900');
    connection.emitLine('$32=1');
    connection.emitLine('ok');
    await read;
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes).toContain('?');
  });

  it('owns the final modal read through its terminal response before polling resumes', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const controls = { autoModalReply: true };
    const connection = makeConnection(async (data) => {
      writes.push(data);
    }, controls);
    await connectWith(connection);
    controls.autoModalReply = false;
    connection.emitLine('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    writes.length = 0;

    const read = useLaserStore.getState().readMachineSettings();
    await flush();
    connection.emitLine('$30=900');
    connection.emitLine('$32=1');
    connection.emitLine('ok');
    await flush();
    expect(writes).toContain('$G\n');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes).not.toContain('?');

    connection.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
    connection.emitLine('ok');
    await read;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes).toContain('?');
  });
});

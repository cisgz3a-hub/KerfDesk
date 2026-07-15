import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_SOFT_RESET } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { DISCONNECT_WRITE_TIMEOUT_MS } from './laser-disconnect-transaction';
import { RESET_CLEANUP_BANNER_TIMEOUT_MS } from './laser-reset-cleanup';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { recoveryRepository } from './recovery';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

function makeConnection(
  label: string,
  events: string[],
  onWrite?: (data: string, emitLine: (line: string) => void) => void | Promise<void>,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      events.push(`${label}:write:${JSON.stringify(data)}`);
      await onWrite?.(data, emitLine);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => {
      events.push(`${label}:close`);
    },
    forget: async () => {
      events.push(`${label}:forget`);
    },
    emitLine,
  };
}

function adapterFor(connection: SerialConnection, events?: string[]): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => {
        events?.push('picker');
        return {
          open: async () => {
            events?.push('open');
            return connection;
          },
        };
      },
    },
  };
}

async function connectReady(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await vi.waitFor(() =>
    expect(useLaserStore.getState().controllerOperation).toMatchObject({ phase: 'settings' }),
  );
  connection.emitLine('$32=1');
  connection.emitLine('ok');
  await vi.waitFor(() => expect(useLaserStore.getState().controllerOperation).toBeNull());
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function safetyEvents(events: ReadonlyArray<string>, label: string): ReadonlyArray<string> {
  const expectedWrites = new Set([
    `${label}:write:${JSON.stringify(RT_SOFT_RESET)}`,
    `${label}:write:${JSON.stringify('M5\n')}`,
    `${label}:write:${JSON.stringify('M9\n')}`,
    `${label}:close`,
  ]);
  return events.filter((event) => expectedWrites.has(event));
}

beforeEach(async () => {
  vi.useRealTimers();
  useLaserStore.setState({ autofocusBusy: false });
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  useLaserStore.setState({ autofocusBusy: false, statusReport: null });
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

describe('intentional GRBL connection teardown', () => {
  it('is inert when no live connection exists', async () => {
    useLaserStore.setState(initialLaserState());

    await useLaserStore.getState().disconnect();

    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });

  it('resets and de-energizes an idle controller before closing it', async () => {
    const events: string[] = [];
    const connection = makeConnection('old', events);
    await connectReady(connection);
    events.length = 0;

    const disconnect = useLaserStore.getState().disconnect();
    await flush();

    expect(safetyEvents(events, 'old')).toEqual([`old:write:${JSON.stringify(RT_SOFT_RESET)}`]);

    connection.emitLine('Grbl 1.1f');
    await disconnect;

    expect(safetyEvents(events, 'old')).toEqual([
      `old:write:${JSON.stringify(RT_SOFT_RESET)}`,
      `old:write:${JSON.stringify('M5\n')}`,
      `old:write:${JSON.stringify('M9\n')}`,
      'old:close',
    ]);
  });

  it('upgrades concurrent Disconnect plus Forget into one full finalization', async () => {
    const events: string[] = [];
    const connection = makeConnection('old', events);
    await connectReady(connection);
    const purge = vi.spyOn(recoveryRepository, 'purgeControllerData');
    useLaserStore.setState({
      log: ['stale controller log'],
      lastWriteError: 'stale controller error',
    });
    events.length = 0;

    const disconnect = useLaserStore.getState().disconnect();
    const forgetDevice = useLaserStore.getState().forgetDevice;
    if (forgetDevice === undefined) throw new Error('Forget Controller action is unavailable.');
    const forget = forgetDevice();
    await flush();
    connection.emitLine('Grbl 1.1f');
    await Promise.all([disconnect, forget]);

    expect(
      events.filter((event) => event === `old:write:${JSON.stringify(RT_SOFT_RESET)}`),
    ).toHaveLength(1);
    expect(events.filter((event) => event === 'old:forget')).toHaveLength(1);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      streamer: null,
      activeRunId: null,
      log: [],
      transcript: [],
      lastWriteError: null,
    });
  });

  it('falls back to cleanup and close when the reboot banner never arrives', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const connection = makeConnection('old', events);
    await connectReady(connection);
    events.length = 0;

    const disconnect = useLaserStore.getState().disconnect();
    await flush();

    expect(safetyEvents(events, 'old')).toEqual([`old:write:${JSON.stringify(RT_SOFT_RESET)}`]);

    await vi.advanceTimersByTimeAsync(RESET_CLEANUP_BANNER_TIMEOUT_MS);
    await disconnect;

    expect(safetyEvents(events, 'old')).toEqual([
      `old:write:${JSON.stringify(RT_SOFT_RESET)}`,
      `old:write:${JSON.stringify('M5\n')}`,
      `old:write:${JSON.stringify('M9\n')}`,
      'old:close',
    ]);
  });

  it('accepts a reboot banner that arrives before the reset write promise settles', async () => {
    const events: string[] = [];
    const connection = makeConnection('old', events, (data, emitLine) => {
      if (data === RT_SOFT_RESET) emitLine('Grbl 1.1f');
    });
    await connectReady(connection);
    events.length = 0;

    await useLaserStore.getState().disconnect();

    expect(safetyEvents(events, 'old')).toEqual([
      `old:write:${JSON.stringify(RT_SOFT_RESET)}`,
      `old:write:${JSON.stringify('M5\n')}`,
      `old:write:${JSON.stringify('M9\n')}`,
      'old:close',
    ]);
    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });

  it('waits for the reboot banner before cleanup and close during an active job', async () => {
    const events: string[] = [];
    const connection = makeConnection('old', events);
    await connectReady(connection);
    const burnLines = Array.from({ length: 40 }, (_, index) => `G1 X${index + 1} S100`);
    await useLaserStore
      .getState()
      .startJob(['G21', 'G90', 'M3 S0', ...burnLines, 'M5', ''].join('\n'));
    events.length = 0;

    const disconnect = useLaserStore.getState().disconnect();
    await flush();

    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(safetyEvents(events, 'old')).toEqual([`old:write:${JSON.stringify(RT_SOFT_RESET)}`]);

    connection.emitLine('ok');
    await flush();
    expect(events.some((event) => event.includes('G1 X'))).toBe(false);

    connection.emitLine('Grbl 1.1f');
    await disconnect;

    expect(safetyEvents(events, 'old')).toEqual([
      `old:write:${JSON.stringify(RT_SOFT_RESET)}`,
      `old:write:${JSON.stringify('M5\n')}`,
      `old:write:${JSON.stringify('M9\n')}`,
      'old:close',
    ]);
    expect(useLaserStore.getState().safetyNotice?.kind).not.toBe('controller-reboot');
  });

  it('aborts the old live controller before opening a replacement connection', async () => {
    const events: string[] = [];
    const oldConnection = makeConnection('old', events);
    const newConnection = makeConnection('new', events);
    await connectReady(oldConnection);
    events.length = 0;

    const reconnect = useLaserStore.getState().connect(adapterFor(newConnection, events));
    await flush();

    expect(safetyEvents(events, 'old')).toEqual([`old:write:${JSON.stringify(RT_SOFT_RESET)}`]);
    expect(events).not.toContain('picker');

    oldConnection.emitLine('Grbl 1.1f');
    await reconnect;

    expect(safetyEvents(events, 'old')).toEqual([
      `old:write:${JSON.stringify(RT_SOFT_RESET)}`,
      `old:write:${JSON.stringify('M5\n')}`,
      `old:write:${JSON.stringify('M9\n')}`,
      'old:close',
    ]);
    expect(events.indexOf('old:close')).toBeLessThan(events.indexOf('picker'));

    newConnection.emitLine('Grbl 1.1f');
    await flush();
    newConnection.emitLine('ok');
    newConnection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    const disconnect = useLaserStore.getState().disconnect();
    await flush();
    newConnection.emitLine('Grbl 1.1f');
    await disconnect;
  });

  it('joins repeated Disconnect calls to one controller reset transaction', async () => {
    const events: string[] = [];
    const connection = makeConnection('old', events);
    await connectReady(connection);
    events.length = 0;

    const first = useLaserStore.getState().disconnect();
    const second = useLaserStore.getState().disconnect();
    await flush();

    expect(
      events.filter((event) => event === `old:write:${JSON.stringify(RT_SOFT_RESET)}`),
    ).toHaveLength(1);

    connection.emitLine('Grbl 1.1f');
    await Promise.all([first, second]);

    expect(
      events.filter((event) => event === `old:write:${JSON.stringify(RT_SOFT_RESET)}`),
    ).toHaveLength(1);
    expect(events.filter((event) => event === `old:write:${JSON.stringify('M5\n')}`)).toHaveLength(
      1,
    );
    expect(events.filter((event) => event === `old:write:${JSON.stringify('M9\n')}`)).toHaveLength(
      1,
    );
    expect(events.filter((event) => event === 'old:close')).toHaveLength(1);
  });

  it('cancels the raw startup-handshake waiter before it can send a settings query', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const connection = makeConnection('old', events);
    await useLaserStore.getState().connect(adapterFor(connection));
    events.length = 0;

    const disconnect = useLaserStore.getState().disconnect();
    await flush();
    connection.emitLine('Grbl 1.1f');
    await disconnect;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_500);
    await flush();

    expect(
      events.filter((event) => event === `old:write:${JSON.stringify(RT_SOFT_RESET)}`),
    ).toHaveLength(1);
    expect(events.some((event) => event.includes(JSON.stringify('$$\n')))).toBe(false);
    expect(events.some((event) => event.includes(JSON.stringify('?')))).toBe(false);
  });

  it('bounds hung reset and cleanup writes so Disconnect still completes', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let hangWrites = false;
    const connection = makeConnection('old', events, () => {
      if (!hangWrites) return;
      return new Promise<void>(() => undefined);
    });
    await connectReady(connection);
    events.length = 0;
    hangWrites = true;

    const disconnect = useLaserStore.getState().disconnect();
    await flush();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await vi.advanceTimersByTimeAsync(DISCONNECT_WRITE_TIMEOUT_MS);
      await flush();
    }
    await disconnect;

    expect(
      events.filter((event) => event === `old:write:${JSON.stringify(RT_SOFT_RESET)}`),
    ).toHaveLength(1);
    expect(events.filter((event) => event === `old:write:${JSON.stringify('M5\n')}`)).toHaveLength(
      1,
    );
    expect(events.filter((event) => event === `old:write:${JSON.stringify('M9\n')}`)).toHaveLength(
      1,
    );
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('write-failed');
  });
});

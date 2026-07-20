import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';
import { recoveryRepository } from './recovery';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

function makeConnection(
  label: string,
  events: string[],
  onCloseRequest?: () => Promise<void>,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  return {
    write: async (data) => {
      events.push(`${label}:write:${JSON.stringify(data)}`);
      respondToTestGrblHandshake(data, (line) => {
        for (const handler of lineHandlers) handler(line);
      });
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => {
      events.push(`${label}:close`);
      await onCloseRequest?.();
    },
    forget: async () => {
      events.push(`${label}:forget`);
    },
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
  };
}

function adapterFor(connection: SerialConnection, events: string[]): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => {
        events.push('picker');
        return {
          open: async () => {
            events.push('open');
            return connection;
          },
        };
      },
    },
  };
}

async function connectReady(connection: FakeConnection, events: string[]): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(connection, events));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await vi.waitFor(() =>
    expect(useLaserStore.getState().controllerOperation).toMatchObject({ phase: 'settings' }),
  );
  connection.emitLine('$32=1');
  connection.emitLine('ok');
  await settleTestGrblHandshake();
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

beforeEach(async () => {
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

describe('replacement connect ownership', () => {
  it('does not let a late SafetyNotice reconnect undo Forget Controller', async () => {
    const events: string[] = [];
    let finishClose = (): void => {
      throw new Error('Transport close did not start.');
    };
    const oldConnection = makeConnection(
      'old',
      events,
      () =>
        new Promise((resolve) => {
          finishClose = resolve;
        }),
    );
    await connectReady(oldConnection, events);
    const purge = vi.spyOn(recoveryRepository, 'purgeControllerData');
    useLaserStore.setState({
      safetyNotice: { kind: 'write-failed', action: 'disconnect', message: 'Reconnect required.' },
    });
    events.length = 0;

    const reconnect = useLaserStore
      .getState()
      .connect(adapterFor(makeConnection('new', events), events));
    await flush();
    oldConnection.emitLine('Grbl 1.1f');
    await vi.waitFor(() => expect(events).toContain('old:close'));
    const forget = useLaserStore.getState().forgetDevice?.();
    if (forget === undefined) throw new Error('Forget Controller action is unavailable.');
    finishClose();
    await Promise.all([reconnect, forget]);

    expect(events.filter((event) => event === 'old:forget')).toHaveLength(1);
    expect(events).not.toContain('picker');
    expect(events).not.toContain('open');
    expect(purge).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().connection).toEqual({ kind: 'disconnected' });
  });

  it('revokes a picker permission granted after Forget cancelled Connect', async () => {
    let resolveRequest: (
      port: Awaited<ReturnType<PlatformAdapter['serial']['requestPort']>>,
    ) => void = () => undefined;
    const requestPort = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<PlatformAdapter['serial']['requestPort']>>>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const open = vi.fn(async () => makeConnection('late', []));
    const forgetPermission = vi.fn(async () => undefined);
    const adapter: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave: async () => null,
      serial: { isSupported: () => true, requestPort },
    };
    const purge = vi.spyOn(recoveryRepository, 'purgeControllerData');

    const connect = useLaserStore.getState().connect(adapter);
    await vi.waitFor(() => expect(requestPort).toHaveBeenCalledOnce());
    const forget = useLaserStore.getState().forgetDevice?.();
    if (forget === undefined) throw new Error('Forget Controller action is unavailable.');
    resolveRequest({ open, forget: forgetPermission });
    await Promise.all([connect, forget]);

    expect(open).not.toHaveBeenCalled();
    expect(forgetPermission).toHaveBeenCalledOnce();
    expect(purge).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().connection).toEqual({ kind: 'disconnected' });
  });

  it('revokes picker permission when a forgotten pending open later rejects', async () => {
    let rejectOpen = (_error: Error): void => undefined;
    const open = vi.fn(
      () =>
        new Promise<SerialConnection>((_resolve, reject) => {
          rejectOpen = reject;
        }),
    );
    const forgetPermission = vi.fn(async () => undefined);
    const adapter: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: async () => [],
      pickFileForSave: async () => null,
      serial: {
        isSupported: () => true,
        requestPort: async () => ({ open, forget: forgetPermission }),
      },
    };
    const purge = vi.spyOn(recoveryRepository, 'purgeControllerData');

    const connect = useLaserStore.getState().connect(adapter);
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    const forget = useLaserStore.getState().forgetDevice?.();
    if (forget === undefined) throw new Error('Forget Controller action is unavailable.');
    rejectOpen(new Error('Open was cancelled.'));
    await Promise.all([connect, forget]);

    expect(forgetPermission).toHaveBeenCalledOnce();
    expect(purge).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().connection).toEqual({ kind: 'disconnected' });
  });

  it.each(['disconnect-during-job', 'disconnect-during-fire'] as const)(
    'retains %s when Forget has no transport on which to confirm a physical stop',
    async (kind) => {
      const purge = vi.spyOn(recoveryRepository, 'purgeControllerData');
      useLaserStore.setState({
        connection: { kind: 'disconnected' },
        safetyNotice: { kind, message: 'The machine may still be active.' },
      });

      await useLaserStore.getState().forgetDevice?.();

      expect(purge).toHaveBeenCalledOnce();
      expect(useLaserStore.getState()).toMatchObject({
        connection: { kind: 'disconnected' },
        streamer: null,
        activeRunId: null,
        safetyNotice: { kind },
      });
    },
  );

  it('clears a stale non-motion notice when Forget has no live transport', async () => {
    useLaserStore.setState({
      connection: { kind: 'disconnected' },
      safetyNotice: {
        kind: 'controller-reboot',
        message: 'Buffered motion was discarded by the reboot.',
      },
    });

    await useLaserStore.getState().forgetDevice?.();

    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });

  it('retains a failed physical stop when Forget has no live transport', async () => {
    useLaserStore.setState({
      connection: { kind: 'disconnected' },
      safetyNotice: {
        kind: 'write-failed',
        action: 'stop',
        message: 'The software stop was not delivered.',
      },
    });

    await useLaserStore.getState().forgetDevice?.();

    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'stop',
    });
  });
});

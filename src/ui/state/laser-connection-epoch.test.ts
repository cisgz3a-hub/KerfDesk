import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  disconnect as disconnectStreamer,
  step,
} from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
  readonly closeCount: () => number;
};

function makeConnection(
  writes: string[] = [],
  onWrite?: (data: string) => void | Promise<void>,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  let closes = 0;
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      writes.push(data);
      await onWrite?.(data);
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
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => {
      closes += 1;
    },
    emitLine: (line) => emit(line),
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
    closeCount: () => closes,
  };
}

function adapterFor(connection: SerialConnection): PlatformAdapter {
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

async function connect(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(connection));
  connection.emitLine('Grbl 1.1h');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await Promise.resolve();
}

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
});

describe('serial connection epoch guards', () => {
  it('does not restart Marlin polling after Forget cancels the startup handshake', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    try {
      const writes: string[] = [];
      const connection = makeConnection(writes);

      await useLaserStore.getState().connect(adapterFor(connection), { controllerKind: 'marlin' });
      const forgetDevice = useLaserStore.getState().forgetDevice;
      if (forgetDevice === undefined) throw new Error('Forget Controller action is unavailable.');
      await forgetDevice();
      await vi.advanceTimersByTimeAsync(1_500);

      expect(writes).not.toContain('M114\n');
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(useLaserStore.getState()).toMatchObject({
        connection: { kind: 'disconnected' },
        lastWriteError: null,
        log: [],
      });
    } finally {
      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('keeps Start blocked until the reconnect settings query receives its terminal acknowledgement', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(writes);

    await useLaserStore.getState().connect(adapterFor(connection));
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'connection-handshake',
      phase: 'waiting-controller',
    });

    connection.emitLine('Grbl 1.1h');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await vi.advanceTimersByTimeAsync(0);

    expect(writes).toContain('$$\n');
    expect(useLaserStore.getState()).toMatchObject({
      controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
      pendingUntrackedAcks: 1,
    });

    connection.emitLine('$0=10');
    await vi.advanceTimersByTimeAsync(2_000);

    expect(useLaserStore.getState()).toMatchObject({
      controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
      pendingUntrackedAcks: 1,
    });

    connection.emitLine('ok');
    await vi.advanceTimersByTimeAsync(0);

    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('does not let an interrupted stream steal the reconnect settings acknowledgement', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(writes);
    const interrupted = disconnectStreamer(
      step(createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100')).state,
    );
    expect(interrupted.inFlight.length).toBeGreaterThan(0);
    useLaserStore.setState({ streamer: interrupted });

    await useLaserStore.getState().connect(adapterFor(connection));
    connection.emitLine('Grbl 1.1h');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await vi.advanceTimersByTimeAsync(0);

    expect(writes).toContain('$$\n');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    connection.emitLine('$0=10');
    connection.emitLine('ok');
    await vi.advanceTimersByTimeAsync(0);

    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().streamer).toMatchObject({
      status: 'disconnected',
      inFlight: [],
      completed: interrupted.completed,
    });

    connection.emitLine('ok');
    await vi.advanceTimersByTimeAsync(0);

    expect(useLaserStore.getState().streamer).toMatchObject({
      status: 'disconnected',
      inFlight: [],
      completed: interrupted.completed,
    });
  });

  it('does not classify a handshake-only disconnect as an interrupted job', async () => {
    vi.useFakeTimers();
    const connection = makeConnection();

    await useLaserStore.getState().connect(adapterFor(connection));
    connection.emitClose();

    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      controllerOperation: null,
      safetyNotice: null,
    });
  });

  it('ignores line and close callbacks from a replaced connection', async () => {
    const oldConnection = makeConnection();
    const currentConnection = makeConnection();
    await connect(oldConnection);
    const replacement = useLaserStore.getState().connect(adapterFor(currentConnection));
    await Promise.resolve();
    oldConnection.emitLine('Grbl 1.1h');
    await replacement;
    currentConnection.emitLine('Grbl 1.1h');
    await Promise.resolve();
    const sessionEpoch = useLaserStore.getState().controllerSessionEpoch;
    const detectedControllerKind = useLaserStore.getState().detectedControllerKind;

    oldConnection.emitLine('Grbl 1.1f');
    oldConnection.emitClose();

    expect(useLaserStore.getState().connection).toEqual({ kind: 'connected' });
    expect(oldConnection.closeCount()).toBe(1);
    expect(useLaserStore.getState().controllerSessionEpoch).toBe(sessionEpoch);
    expect(useLaserStore.getState().detectedControllerKind).toBe(detectedControllerKind);
  });

  it('does not let an old handshake timeout erase the replacement connection callback', async () => {
    vi.useFakeTimers();
    const oldConnection = makeConnection();
    const currentWrites: string[] = [];
    const currentConnection = makeConnection(currentWrites);

    await useLaserStore.getState().connect(adapterFor(oldConnection));
    await vi.advanceTimersByTimeAsync(100);
    const replacement = useLaserStore.getState().connect(adapterFor(currentConnection));
    await vi.advanceTimersByTimeAsync(0);
    oldConnection.emitLine('Grbl 1.1h');
    await vi.advanceTimersByTimeAsync(0);
    await replacement;
    await vi.advanceTimersByTimeAsync(151);
    currentConnection.emitLine('Grbl 1.1h');
    currentConnection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await vi.advanceTimersByTimeAsync(300);

    expect(currentWrites).toContain('$$\n');
    expect(currentWrites).not.toContain('?');
  });

  it('does not publish a handshake failure into the epoch created by a later reboot', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let rejectStatusQuery = (_error: Error): void => {
      throw new Error('Status query rejection was not installed.');
    };
    const connection = makeConnection(writes, (data) => {
      if (data !== '?') return;
      return new Promise<void>((_resolve, reject) => {
        rejectStatusQuery = reject;
      });
    });

    await useLaserStore.getState().connect(adapterFor(connection));
    connection.emitLine('Grbl 1.1h');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toContain('?');
    const firstWelcomeEpoch = useLaserStore.getState().controllerSessionEpoch;

    connection.emitLine('Grbl 1.1h');
    const currentEpoch = useLaserStore.getState().controllerSessionEpoch;
    expect(currentEpoch).toBe(firstWelcomeEpoch + 1);
    rejectStatusQuery(new Error('stale handshake write failed'));
    await vi.advanceTimersByTimeAsync(0);

    expect(useLaserStore.getState()).toMatchObject({
      controllerSessionEpoch: currentEpoch,
      controllerQualification: {
        kind: 'qualifying',
        epoch: currentEpoch,
        phase: 'reset-cleanup',
      },
      lastWriteError: null,
    });
  });

  it('accepts only the first welcome boundary in one startup handshake', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const connection = makeConnection(writes);

    await useLaserStore.getState().connect(adapterFor(connection));
    connection.emitLine('Grbl 1.1h');
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toContain('?');

    connection.emitLine('Grbl 1.1h');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await vi.advanceTimersByTimeAsync(0);

    expect(writes).not.toContain('$$\n');
    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'qualifying',
      phase: 'reset-cleanup',
    });
  });
});

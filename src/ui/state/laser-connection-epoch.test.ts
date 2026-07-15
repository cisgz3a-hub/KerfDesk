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

function makeConnection(writes: string[] = []): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  let closes = 0;
  return {
    write: async (data) => {
      writes.push(data);
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
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
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
  await Promise.resolve();
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.useRealTimers();
});

describe('serial connection epoch guards', () => {
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
    await connect(currentConnection);
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
    await useLaserStore.getState().connect(adapterFor(currentConnection));
    await vi.advanceTimersByTimeAsync(151);
    currentConnection.emitLine('Grbl 1.1h');
    await vi.advanceTimersByTimeAsync(300);

    expect(currentWrites).toContain('$$\n');
    expect(currentWrites).not.toContain('?');
  });
});

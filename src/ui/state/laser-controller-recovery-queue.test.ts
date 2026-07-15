import { afterEach, describe, expect, it } from 'vitest';
import {
  createStreamer,
  disconnect as disconnectStreamer,
  step,
} from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly setWriteHandler: (handler: (data: string) => Promise<void>) => void;
};

function fakeConnection(writes: string[]): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  let writeHandler = async (_data: string): Promise<void> => undefined;
  return {
    write: async (data) => {
      writes.push(data);
      await writeHandler(data);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
    setWriteHandler: (handler) => {
      writeHandler = handler;
    },
  };
}

function adapter(connection: SerialConnection): PlatformAdapter {
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

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function connectAndDrainHandshake(
  connection: FakeConnection,
  writes: string[],
): Promise<void> {
  await useLaserStore.getState().connect(adapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  expect(writes).toContain('$$\n');
  connection.emitLine('ok');
  await flush();
  expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
}

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    controllerOperation: null,
    pendingTransportWrites: 0,
    pendingUntrackedAcks: 0,
    safetyNotice: null,
    statusReport: null,
    streamer: null,
  });
});

describe('controller recovery queue ownership', () => {
  it('retires disconnected stream acks when a fast recovery reset banner arrives', async () => {
    const writes: string[] = [];
    const connection = fakeConnection(writes);
    await connectAndDrainHandshake(connection, writes);

    const streaming = step(
      createStreamer('G1 X1\nG1 X2\nG1 X3', { streamingMode: 'char-counted' }),
    ).state;
    useLaserStore.setState({ streamer: disconnectStreamer(streaming) });
    expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(3);

    connection.setWriteHandler(async (data) => {
      if (data === '\x18') connection.emitLine('Grbl 1.1f');
    });
    const recovered = expect(useLaserStore.getState().wakeController()).resolves.toBeUndefined();
    await flush();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await recovered;

    expect(useLaserStore.getState().streamer?.inFlight).toEqual([]);
    await useLaserStore.getState().sendConsoleCommand('$$');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);

    connection.emitLine('ok');
    connection.emitLine('ok');
    await flush();

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().streamer?.completed).toBe(0);
  });

  it('keeps the recovery Idle wait when the reset banner follows transport completion', async () => {
    const writes: string[] = [];
    const connection = fakeConnection(writes);
    await connectAndDrainHandshake(connection, writes);

    const recovered = expect(useLaserStore.getState().wakeController()).resolves.toBeUndefined();
    await flush();
    connection.emitLine('Grbl 1.1f');
    await flush();
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');

    await recovered;
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });
});

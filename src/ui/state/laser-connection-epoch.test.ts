import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
  readonly closeCount: () => number;
};

function makeConnection(): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  let closes = 0;
  return {
    write: async () => undefined,
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
});

describe('serial connection epoch guards', () => {
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
});

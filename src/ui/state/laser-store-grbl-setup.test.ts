import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

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
    emitLine: (line) => lineHandlers.forEach((handler) => handler(line)),
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

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  vi.restoreAllMocks();
});

describe('retired fixed GRBL setup action', () => {
  it('is inert even when called directly by an old UI or fixture', async () => {
    await expect(useLaserStore.getState().configureGrblLaserSetup()).rejects.toThrow(
      /fixed GRBL setup batches were removed/i,
    );
    expect(useLaserStore.getState().lastWriteError).toMatch(
      /one verified common setting at a time/i,
    );
  });

  it('never writes after a controller is connected and settings are available', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await useLaserStore.getState().connect(adapter(connection));
    connection.emitLine('Grbl 1.1f');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    connection.emitLine('$30=1000');
    connection.emitLine('$32=1');
    connection.emitLine('$130=400');
    connection.emitLine('ok');
    await new Promise((resolve) => setTimeout(resolve, 0));
    writes.length = 0;

    await expect(useLaserStore.getState().configureGrblLaserSetup()).rejects.toThrow(
      /machine travel and power values must never be assumed/i,
    );
    expect(writes).toEqual([]);
  });
});

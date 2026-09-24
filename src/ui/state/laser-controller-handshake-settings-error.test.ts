// A connect-time `$$` the controller answers with an error must not leave the
// settings collector running: every later settings read, the qualification
// Retry button's included, was refused as "already being read" until a reset
// or reconnect (controller audit 2026-09-23, settings-console-4).

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0>';

function makeConnection(writes: string[], answerSettings: () => ReadonlyArray<string>) {
  const handlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of handlers) handler(line);
  };
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      if (data === '?') queueMicrotask(() => emit(IDLE));
      if (data === '$$\n') queueMicrotask(() => answerSettings().forEach(emit));
      if (data === '$I\n') {
        queueMicrotask(() => ['[VER:1.1h.20190830:]', '[OPT:V,15,128]', 'ok'].forEach(emit));
      }
      if (data === '$G\n')
        queueMicrotask(() => ['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok'].forEach(emit));
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: emit,
  };
  return connection;
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

describe('connect-time settings read that fails', () => {
  it('lets the Retry read the settings instead of refusing it as already running', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const writes: string[] = [];
    let settingsReply: ReadonlyArray<string> = ['error:8'];
    const connection = makeConnection(writes, () => settingsReply);
    await useLaserStore.getState().connect(adapter(connection));
    connection.emitLine('Grbl 1.1h');
    connection.emitLine(IDLE);
    await vi.waitFor(
      () => expect(useLaserStore.getState().controllerQualification.kind).toBe('failed'),
      { timeout: 4_000 },
    );

    settingsReply = ['$30=1000', '$32=1', '$130=400', '$131=300', 'ok'];
    writes.length = 0;
    await useLaserStore.getState().retryControllerQualification();

    expect(writes).toContain('$$\n');
    expect(useLaserStore.getState().lastWriteError ?? '').not.toMatch(/already being read/i);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
  });
});

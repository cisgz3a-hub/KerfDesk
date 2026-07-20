import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(onWrite: (data: string) => void): FakeConnection {
  const handlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of handlers) handler(line);
  };
  return {
    write: async (data) => {
      onWrite(data);
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: emit,
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

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

describe('connecting into an Alarm keeps the status feed alive', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await useLaserStore.getState().disconnect();
    useLaserStore.setState({
      connection: { kind: 'disconnected' },
      statusReport: null,
      log: [],
      transcript: [],
    });
    vi.restoreAllMocks();
  });

  // Regression: a controller already locked in Alarm at connect (no welcome
  // banner, answers `?` with <Alarm|...>, never reaches Idle) used to leave the
  // status poll dead — the handshake rejected before claiming its operation, so
  // the connect cleanup bailed and never started polling. The app went
  // permanently deaf: no fresh status arrived, so the Alarm never cleared the
  // stale jog/controller operation, and jog, unlock, and the console (its `$X`
  // greyed out) all froze. The status feed must run regardless of connect
  // outcome so operators can always recover.
  it('starts the status poll even when the controller is in Alarm at connect', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const connection = makeConnection(() => undefined);

    await useLaserStore.getState().connect(makeAdapter(connection));
    // Welcome banner drives the handshake past its initial line wait; then the
    // controller reports Alarm and never reaches Idle, so the handshake's
    // fresh-Idle wait rejects and connect cleanup runs.
    connection.emitLine('Grbl 1.1f');
    await flush();
    connection.emitLine('<Alarm|MPos:0.000,0.000,40.450|FS:0,0|Pn:Z>');
    await flush();

    expect(setIntervalSpy).toHaveBeenCalled();
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
  });
});

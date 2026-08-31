import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

const HANDSHAKE_TIMEOUT_MS = 2_000;
const IDLE_POLL_CADENCE_MS = 1_000;

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(onWrite: (data: string) => Promise<void>): FakeConnection {
  const handlers = new Set<(line: string) => void>();
  return {
    write: onWrite,
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of handlers) handler(line);
    },
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

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let finish: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: () => finish?.() };
}

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
});

describe('background controller status polling', () => {
  it('keeps one status write in flight while a slow transport promise is pending', async () => {
    vi.useFakeTimers();
    const pendingPoll = deferred();
    const statusWrites: string[] = [];
    const connection = makeConnection(async (data) => {
      if (data !== '?') return;
      statusWrites.push(data);
      if (statusWrites.length > 1) await pendingPoll.promise;
    });

    await useLaserStore.getState().connect(adapterFor(connection));
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS);
    expect(statusWrites).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(IDLE_POLL_CADENCE_MS);
    expect(statusWrites).toHaveLength(2);

    connection.emitLine('<Idle|MPos:1.000,2.000,3.000|FS:0,0>');
    expect(useLaserStore.getState().statusReport?.mPos).toEqual({ x: 1, y: 2, z: 3 });

    await vi.advanceTimersByTimeAsync(IDLE_POLL_CADENCE_MS * 3);
    expect(statusWrites).toHaveLength(2);

    pendingPoll.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(IDLE_POLL_CADENCE_MS);
    expect(statusWrites).toHaveLength(3);
  });
});

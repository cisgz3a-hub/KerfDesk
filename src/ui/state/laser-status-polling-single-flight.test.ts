import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { POLLED_RESPONSE_TIMEOUT_MS } from './laser-controller-qualification';
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
    const requests: string[] = [];
    const connection = makeConnection(async (data) => {
      requests.push(data);
      const replies: Record<string, readonly string[]> = {
        '$$\n': ['$30=1000', '$31=0', '$32=1', 'ok'],
        '$I\n': ['[VER:1.1h.20190830:test]', '[OPT:VM,15,128]', 'ok'],
        '$G\n': ['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok'],
      };
      for (const line of replies[data] ?? []) connection.emitLine(line);
      if (data !== '?') return;
      statusWrites.push(data);
      if (statusWrites.length > 1) await pendingPoll.promise;
    });

    await useLaserStore.getState().connect(adapterFor(connection));
    await vi.advanceTimersByTimeAsync(HANDSHAKE_TIMEOUT_MS);
    expect(statusWrites).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(IDLE_POLL_CADENCE_MS);
    expect(statusWrites).toHaveLength(2);

    // Silence fails qualification. A late Idle resumes the automatic settings
    // workflow after the unresolved status write settles.
    await vi.advanceTimersByTimeAsync(POLLED_RESPONSE_TIMEOUT_MS);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(statusWrites).toHaveLength(2);

    connection.emitLine('<Idle|MPos:1.000,2.000,3.000|FS:0,0>');
    expect(useLaserStore.getState().statusReport?.mPos).toEqual({ x: 1, y: 2, z: 3 });

    await vi.advanceTimersByTimeAsync(IDLE_POLL_CADENCE_MS * 3);
    expect(statusWrites).toHaveLength(2);

    expect(requests).not.toContain('$$\n');
    pendingPoll.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(IDLE_POLL_CADENCE_MS);
    expect(statusWrites).toHaveLength(3);
    expect(requests.filter((request) => request === '$$\n')).toHaveLength(1);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
  });
});

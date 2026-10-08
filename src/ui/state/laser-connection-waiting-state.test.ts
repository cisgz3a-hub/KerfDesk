import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
};
let liveConnection: FakeConnection | null = null;

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

async function connectController(
  writes: string[],
  statusState: () => string,
  settingsResponse: 'valid' | 'empty' | 'rejected' = 'valid',
): Promise<FakeConnection> {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      if (data === '?') emitLine(`<${statusState()}|MPos:0,0,0|FS:0,0>`);
      if (data === '$I\n') {
        emitLine('[VER:1.1h.20190830:test]');
        emitLine('[OPT:VM,15,128]');
        emitLine('ok');
      }
      if (data === '$G\n') {
        emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emitLine('ok');
      }
      if (data === '$$\n') {
        if (settingsResponse === 'valid') {
          emitLine('$30=1000');
          emitLine('$31=0');
          emitLine('$32=1');
        }
        emitLine(settingsResponse === 'rejected' ? 'error:9' : 'ok');
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
    close: async () => undefined,
    emitLine,
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
  };
  liveConnection = connection;
  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
  await useLaserStore.getState().connect(adapter);
  connection.emitLine('Grbl 1.1f');
  await flush();
  return connection;
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  liveConnection?.emitClose();
  liveConnection = null;
  await flush();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('connection handshake waiting for controller Idle', () => {
  it.each(['Run', 'Hold:0', 'Door:1', 'Alarm', 'Sleep'])(
    'keeps %s as a waiting state and reads settings after the controller becomes Idle',
    async (initialStatus) => {
      const writes: string[] = [];
      let currentStatus = initialStatus;
      const connection = await connectController(writes, () => currentStatus);

      await vi.advanceTimersByTimeAsync(8_100);
      await flush();
      expect(useLaserStore.getState().connection.kind).toBe('connected');
      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualifying');
      expect(
        (useLaserStore.getState().incidentHistory ?? []).filter(
          (entry) =>
            entry.raw.startsWith('[lf2] Controller handshake failed:') ||
            entry.raw.startsWith('[lf2] Controller information refresh timed out:'),
        ),
      ).toEqual([]);
      expect(writes).not.toContain('$$\n');

      currentStatus = 'Idle';
      connection.emitLine('<Idle|MPos:0,0,0|FS:0,0>');
      await vi.advanceTimersByTimeAsync(500);
      await flush();

      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
      expect(writes.filter((line) => line === '$$\n')).toHaveLength(1);
    },
  );

  it.each(['empty', 'rejected'] as const)(
    'keeps an attempted %s settings response failed instead of silently rereading it',
    async (settingsResponse) => {
      const writes: string[] = [];
      await connectController(writes, () => 'Idle', settingsResponse);
      await vi.advanceTimersByTimeAsync(100);
      await flush();

      expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
      expect(writes.filter((line) => line === '$$\n')).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(10_000);
      await flush();
      expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
      expect(writes.filter((line) => line === '$$\n')).toHaveLength(1);
    },
  );
});

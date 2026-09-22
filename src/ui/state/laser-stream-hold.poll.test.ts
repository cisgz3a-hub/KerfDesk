// The poll tick end to end: a controller that answers every `?` with Idle
// but never acknowledges the job lines is named as holding the program,
// logged once, and cleared (with its duration) once the acknowledgements come.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { STREAM_HOLD_VISIBLE_MS } from './laser-stream-hold';
import { startTestLaserJob } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
};

function makeConnection(writes: string[]): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const connection: FakeConnection = {
    write: async (data) => {
      writes.push(data);
      if (data === '?') {
        // Like the real reader, deliver the reply after the poll callback.
        void Promise.resolve().then(() =>
          connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Bf:15,128>'),
        );
      }
      if (
        data === '$I\n' &&
        useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
      ) {
        connection.emitLine('[VER:1.1h.20190830:test]');
        connection.emitLine('[OPT:VM,15,128]');
        connection.emitLine('ok');
      }
      if (data === '$G\n') {
        connection.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        connection.emitLine('ok');
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
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
  };
  return connection;
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

const PROGRAM = 'G1 X1 S100\nG1 X2 S100\nG1 X3 S100';

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
});

let liveConnection: FakeConnection | null = null;

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

async function connectReady(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(adapterFor(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Bf:15,128>');
  await flush();
  connection.emitLine('$32=1');
  connection.emitLine('ok');
  await flush();
  await flush();
}

afterEach(async () => {
  liveConnection?.emitClose();
  liveConnection = null;
  await flush();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
});

describe('poll tick controller-hold telemetry', () => {
  it('names an Idle controller that withholds acknowledgements and clears once they arrive', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    liveConnection = connection;
    await connectReady(connection);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    expect(useLaserStore.getState().controllerOperation).toBeNull();

    await startTestLaserJob(PROGRAM);
    expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(3);
    expect(useLaserStore.getState().streamHold ?? null).toBeNull();

    await vi.advanceTimersByTimeAsync(STREAM_HOLD_VISIBLE_MS + 750);
    const held = useLaserStore.getState();
    expect(held.streamer?.status).toBe('streaming');
    expect(held.streamHold?.unacknowledgedLines).toBe(3);
    expect(held.streamHold?.controllerState).toBe('Idle');
    const beganLines = held.log.filter((line) => line.includes('Controller holding program'));
    expect(beganLines).toHaveLength(1);
    expect(beganLines[0]).toContain('3 sent lines');
    expect(beganLines[0]).toContain('Bf 15 blocks / 128 B free');
    // Not a safety event: the link is alive and the app is simply waiting.
    expect(held.safetyNotice).toBeNull();

    // The timer keeps moving without re-logging the same episode.
    await vi.advanceTimersByTimeAsync(2_000);
    const later = useLaserStore.getState();
    expect(later.streamHold?.since).toBe(held.streamHold?.since);
    expect(later.log.filter((line) => line.includes('Controller holding program'))).toHaveLength(1);

    connection.emitLine('ok');
    connection.emitLine('ok');
    connection.emitLine('ok');
    await vi.advanceTimersByTimeAsync(500);
    const resumed = useLaserStore.getState();
    expect(resumed.streamHold ?? null).toBeNull();
    expect(resumed.log.some((line) => line.includes('Controller resumed acknowledging'))).toBe(
      true,
    );
  });
});

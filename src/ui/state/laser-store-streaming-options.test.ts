import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      if (
        data === '$I\n' &&
        useLaserStore.getState().controllerOperation?.kind === 'connection-handshake'
      ) {
        emit('[VER:1.1h.20190830:test]');
        emit('[OPT:VM,15,128]');
        emit('ok');
      }
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
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
      requestPort: async () => ({
        open: async () => connection,
      }),
    },
  };
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  // Let the handshake's $$ write land, then ack it like real GRBL does —
  // startJob waits for owed untracked acks to drain.
  await flushConnect();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flushConnect();
}

async function flushConnect(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

describe('laser-store profile streaming options', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await useLaserStore.getState().disconnect();
    vi.restoreAllMocks();
  });

  it('uses the configured RX buffer limit before starting the stream', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await expect(startTestLaserJob('G21\nG1 X1234567890\n', { rxBufferBytes: 10 })).rejects.toThrow(
      /10-byte RX buffer/i,
    );

    expect(useLaserStore.getState().streamer).toBeNull();
    expect(writes).toEqual([]);
  });

  it('honors ping-pong streaming mode for the initial send window', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await startTestLaserJob('G21\nG90\nM3 S0\nM5\n', { streamingMode: 'ping-pong' });

    expect(writes[0]).toBe('G21\n');
    expect(useLaserStore.getState().streamer).toMatchObject({
      streamingMode: 'ping-pong',
      rxBufferBytes: 120,
      inFlight: [{ line: 'G21\n', bytes: 4 }],
      completed: 0,
    });
  });
});

// The one test that walks the whole ADR-331 path on the real store: a grblHAL
// controller reports its receive ring in a status frame, and the job that
// starts afterwards streams with the window that report proved.
describe('laser-store grblHAL receive-capacity evidence (ADR-331)', () => {
  function makeGrblHalConnection(writes: string[]): FakeConnection {
    const lineHandlers = new Set<(line: string) => void>();
    const emit = (line: string): void => {
      for (const handler of lineHandlers) handler(line);
    };
    return {
      write: async (data) => {
        writes.push(data);
        // grblHAL is not asked for `$I` (its extended response is not stock
        // proof), so the handshake is the settings dump plus the modal read.
        if (data === '$$\n') {
          emit('$30=1000');
          emit('$32=1');
          emit('ok');
        }
        if (data === '$G\n') {
          emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
          emit('ok');
        }
      },
      onLine: (handler) => {
        lineHandlers.add(handler);
        return () => lineHandlers.delete(handler);
      },
      onClose: () => () => undefined,
      close: async () => undefined,
      emitLine: emit,
    };
  }

  it('streams the profile window a Bf report proved, instead of the stock fallback', async () => {
    const writes: string[] = [];
    const connection = makeGrblHalConnection(writes);
    await useLaserStore.getState().connect(makeAdapter(connection), { controllerKind: 'grblhal' });
    connection.emitLine("GrblHAL 1.1f ['$' or '$HELP' for help]");
    await flushConnect();
    // Bf values a maintainer's Falcon A1 Pro reported on 2026-07-19 (ADR-331); the
    // rest of this frame, the banner and the handshake are synthetic grblHAL.
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000,0.000|Bf:512,65535|FS:0,0>');
    await flushConnect();

    expect(useLaserStore.getState().activeControllerKind).toBe('grblhal');
    expect(useLaserStore.getState().rxCapacityEvidence).toMatchObject({
      rxBytesFree: 65535,
      plannerBlocksFree: 512,
    });

    writes.length = 0;
    await startTestLaserJob('G21\nG90\nM4 S0\nG1 X1.000 S1000\nM5\n', {
      streamingMode: 'char-counted',
      rxBufferBytes: 1024,
    });

    // 1024 bytes holds the whole tiny program, so every line goes out at once —
    // the stock 120-byte fallback would have sent the same five short lines,
    // so assert the window itself, not the write shape.
    expect(useLaserStore.getState().streamer).toMatchObject({ rxBufferBytes: 1024 });
    expect(writes.join('')).toContain('G1 X1.000 S1000\n');
  });

  it('falls back to the stock window when no Bf report arrived this session', async () => {
    const writes: string[] = [];
    const connection = makeGrblHalConnection(writes);
    await useLaserStore.getState().connect(makeAdapter(connection), { controllerKind: 'grblhal' });
    connection.emitLine("GrblHAL 1.1f ['$' or '$HELP' for help]");
    await flushConnect();
    // A status frame without the buffer-state field ($10 bit clear).
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000,0.000|FS:0,0>');
    await flushConnect();

    expect(useLaserStore.getState().rxCapacityEvidence ?? null).toBeNull();

    await startTestLaserJob('G21\nG90\nM4 S0\nG1 X1.000 S1000\nM5\n', {
      streamingMode: 'char-counted',
      rxBufferBytes: 1024,
    });

    expect(useLaserStore.getState().streamer).toMatchObject({ rxBufferBytes: 120 });
  });
});

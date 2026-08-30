import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { respondToStockGrblHandshakeQuery } from './laser-controller-handshake.test-support';
import { useLaserStore } from './laser-store';

export type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

/**
 * Creates a deterministic serial test connection. Fresh-status replies are
 * disabled by default; enabling them emits Idle after two microtask turns.
 */
export function makeConnection(
  write: (data: string) => Promise<void>,
  options: { readonly autoRespondToStatusQuery?: boolean } = {},
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      respondToStockGrblHandshakeQuery(data, emit);
      if (data === '?' && options.autoRespondToStatusQuery === true) {
        // The production transport delivers the reply asynchronously. Two
        // microtask turns ensure confirmFreshManualMotionIdle has recorded its
        // post-write stamp and installed the fresh-status waiter first.
        queueMicrotask(() => {
          queueMicrotask(() => {
            emit('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
          });
        });
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
      requestPort: async () => ({ open: async () => connection }),
    },
  };
}

/** Connects the laser store to a fake GRBL session and completes its handshake. */
export async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  // Let the handshake's $$ write land, then ack it like real GRBL does —
  // startJob waits for owed untracked acks to drain.
  await flushConnect();
  connection.emitLine('ok');
  await flushConnect();
}

/** Advances the promise queue far enough for the deterministic fake handshake. */
export async function flushConnect(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

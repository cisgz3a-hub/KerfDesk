import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { respondToStockGrblHandshakeQuery } from './laser-controller-handshake.test-support';
import { useLaserStore } from './laser-store';

// Shared serial-connection fake and connect/flush helpers for the console
// command test suites (split across laser-store-console*.test.ts to stay
// under the file line cap).

export type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

export function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      // Complete only queries still owned by the connection handshake. The
      // later console $$ under test is an interactive command, so it remains
      // unanswered and can exercise rejection/timeout cleanup.
      respondToStockGrblHandshakeQuery(data, emit);
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

export function makeAdapter(connection: SerialConnection): PlatformAdapter {
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

export async function flushConnect(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

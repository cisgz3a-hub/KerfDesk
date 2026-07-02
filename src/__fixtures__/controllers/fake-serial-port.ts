// fake-serial-port — an in-memory SerialConnection + PlatformAdapter pair for
// firmware simulators and integration tests. No timers, no protocol knowledge:
// it only moves strings between the host (laser-store) and whatever firmware
// model is attached via onWrite.

import type {
  PlatformAdapter,
  SerialConnection,
  SerialOpenRequest,
} from '../../platform/types';

export type FakeSerialPort = {
  /** The connection handed to laser-store when it opens the port. */
  readonly connection: SerialConnection;
  /** Mock PlatformAdapter whose requestPort()/open() yields `connection`. */
  readonly adapter: PlatformAdapter;
  /** Firmware → host: deliver one line to every onLine subscriber. */
  readonly emitLine: (line: string) => void;
  /** Simulate a cable yank / OS port close. Fires onClose handlers once. */
  readonly emitClose: () => void;
  /** Host → firmware: subscribe to raw write payloads. */
  readonly onWrite: (handler: (data: string) => void) => () => void;
  /** Fires when the adapter's open() is called (banner scheduling hook). */
  readonly onOpen: (handler: (req: SerialOpenRequest) => void) => () => void;
  /** Every raw payload the host has written, in order. */
  readonly outbound: () => ReadonlyArray<string>;
  /** Baud rates passed to open(), in order (usually length 1). */
  readonly openRequests: () => ReadonlyArray<SerialOpenRequest>;
  readonly isClosed: () => boolean;
};

export function createFakeSerialPort(): FakeSerialPort {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const writeHandlers = new Set<(data: string) => void>();
  const openHandlers = new Set<(req: SerialOpenRequest) => void>();
  const outbound: string[] = [];
  const openRequests: SerialOpenRequest[] = [];
  let closed = false;

  const connection: SerialConnection = {
    write: async (data) => {
      if (closed) throw new Error('Fake serial port is closed.');
      outbound.push(data);
      for (const handler of [...writeHandlers]) handler(data);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => {
      closed = true;
    },
  };

  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({
        open: async (req) => {
          openRequests.push(req);
          closed = false;
          for (const handler of [...openHandlers]) handler(req);
          return connection;
        },
      }),
    },
  };

  return {
    connection,
    adapter,
    emitLine: (line) => {
      if (closed) return;
      for (const handler of [...lineHandlers]) handler(line);
    },
    emitClose: () => {
      if (closed) return;
      closed = true;
      for (const handler of [...closeHandlers]) handler();
    },
    onWrite: (handler) => {
      writeHandlers.add(handler);
      return () => writeHandlers.delete(handler);
    },
    onOpen: (handler) => {
      openHandlers.add(handler);
      return () => openHandlers.delete(handler);
    },
    outbound: () => [...outbound],
    openRequests: () => [...openRequests],
    isClosed: () => closed,
  };
}

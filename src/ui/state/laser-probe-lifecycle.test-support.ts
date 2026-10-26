// Fake serial connection and requests shared by the probe lifecycle tests.

import {
  DEFAULT_PLATE_CENTER_OFFSET_X_MM,
  DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
  DEFAULT_SIDE_CLEARANCE_MM,
} from '../../core/controllers/grbl';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { markProbeCircuitTested } from './probe-test-touch.test-support';

export type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly emitClose: () => void;
  readonly listenerCount: () => number;
};

export const Z_REQUEST = {
  kind: 'z',
  params: {
    plateThicknessMm: 15,
    seekFeedMmPerMin: 150,
    probeFeedMmPerMin: 25,
    maxTravelMm: 25,
    retractMm: 5,
  },
} satisfies ProbeRequest;

export const CORNER_REQUEST = {
  kind: 'corner',
  params: {
    ...Z_REQUEST.params,
    bitDiameterMm: 6.35,
    toolKind: 'end-mill',
    corner: 'front-left',
    plateCenterOffsetXmm: DEFAULT_PLATE_CENTER_OFFSET_X_MM,
    plateCenterOffsetYmm: DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
    sideDropMm: 3,
    sideClearanceMm: DEFAULT_SIDE_CLEARANCE_MM,
  },
} satisfies ProbeRequest;

export function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
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
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => undefined,
    emitLine: emit,
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
    listenerCount: () => lineHandlers.size,
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

export async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  // Every test probes after it connects; the lead counts as tested there
  // (probe-test-touch.ts, ADR-103 Amendment 2).
  markProbeCircuitTested();
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 48; i += 1) await Promise.resolve();
}

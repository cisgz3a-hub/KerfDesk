import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { respondToTestGrblBuildInfo, settleTestGrblHandshake } from './laser-test-start-helpers';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(
  onWrite: (data: string, connection: FakeConnection) => void,
): FakeConnection {
  const handlers = new Set<(line: string) => void>();
  const connection: FakeConnection = {
    write: async (data) => onWrite(data, connection),
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => handlers.forEach((handler) => handler(line)),
  };
  return connection;
}

function adapter(connection: FakeConnection): PlatformAdapter {
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
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('owned controller Work-Z recovery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    resetStore();
    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    useLaserStore.setState(initialLaserState());
  });

  afterEach(async () => {
    await useLaserStore
      .getState()
      .disconnect()
      .catch(() => undefined);
    useLaserStore.setState(initialLaserState());
    vi.restoreAllMocks();
  });

  it('owns $G and $# replies before creating tool-bound evidence', async () => {
    const writes: string[] = [];
    const connection = makeConnection((data, conn) => {
      writes.push(data);
      respondToTestGrblBuildInfo(data, conn.emitLine);
      queueMicrotask(() => {
        if (data === '$G\n') {
          conn.emitLine('[GC:G0 G55 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
          conn.emitLine('ok');
        }
        if (data === '$#\n') {
          conn.emitLine('[G54:0.000,0.000,0.000]');
          conn.emitLine('[G55:4.000,5.000,-6.250]');
          conn.emitLine('ok');
        }
      });
    });
    await useLaserStore.getState().connect(adapter(connection));
    connection.emitLine('Grbl 1.1f');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await settleTestGrblHandshake();

    await useLaserStore.getState().recoverWorkZFromController({
      activeToolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      controllerOffsetRepresentsStockTop: true,
    });

    const workZReads = writes.filter((command) => command === '$G\n' || command === '$#\n');
    expect(workZReads).toEqual(['$G\n', '$#\n', '$G\n']);
    expect(writes).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(?:G0|G1|G2|G3|G10|G38|G92|\$\d+=)/i)]),
    );
    expect(useLaserStore.getState().workZZeroEvidence).toMatchObject({
      source: 'controller-readback',
      activeWcs: 'G55',
      offsetZMm: -6.25,
      toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      controllerSessionEpoch: useLaserStore.getState().controllerSessionEpoch,
    });
  });
});

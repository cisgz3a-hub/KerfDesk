import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { startMotionOperation } from './laser-motion-operation';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

describe('CNC jog-to-point readiness ordering', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    useLaserStore.setState({ autofocusBusy: false, fireActive: false });
    useStore.getState().setMachineKind('laser');
    await useLaserStore.getState().disconnect();
    useLaserStore.setState({
      connection: { kind: 'disconnected' },
      statusReport: null,
      motionOperation: null,
      controllerOperation: null,
      fireActive: false,
      autofocusBusy: false,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: 'the controller is not Idle',
      arrange: (connection: FakeConnection) => connection.emitLine('<Run|MPos:50,30,0|FS:1000,0>'),
      message: /must be Idle/i,
    },
    {
      name: 'another motion operation is active',
      arrange: () => useLaserStore.setState({ motionOperation: startMotionOperation('jog') }),
      message: /jog or frame operation is active/i,
    },
    {
      name: 'a controller operation is active',
      arrange: () =>
        useLaserStore.setState({
          controllerOperation: { kind: 'home', phase: 'awaiting-idle', idleReports: 0 },
        }),
      message: /controller operation is active/i,
    },
    {
      name: 'momentary Fire is active',
      arrange: () => useLaserStore.setState({ fireActive: true }),
      message: /Release the momentary Fire/i,
    },
    {
      name: 'autofocus is active',
      arrange: () => useLaserStore.setState({ autofocusBusy: true }),
      message: /Auto-focus is running/i,
    },
  ])('writes no retract or XY motion when $name', async ({ arrange, message }) => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    connection.emitLine('<Idle|MPos:50,30,0|FS:0,0>');
    arrange(connection);
    writes.length = 0;

    await expect(useLaserStore.getState().jogToMachinePosition(120, 80, 1000)).rejects.toThrow(
      message,
    );
    expect(writes).toEqual([]);
  });
});

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  return {
    write,
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
  };
}

async function connectWith(connection: FakeConnection): Promise<void> {
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
  await Promise.resolve();
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { captureWorkZZeroEvidence } from './work-z-zero-evidence';

// Minimal serial harness (mirrors laser-store-motion-operation.test.ts).
type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

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

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  useStore.getState().setMachineKind('laser');
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    lastWriteError: null,
    motionOperation: null,
    workZZeroEvidence: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
});

describe('jogToMachinePosition', () => {
  it('jogs the relative delta from the current machine position', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    writes.length = 0;

    // Head at machine (50,30); target the board corner at machine (120,80).
    await useLaserStore.getState().jogToMachinePosition(120, 80, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X70.000 Y50.000 F1000\n',
    ]);
  });

  it('reaches the (0,0) origin corner from a nonzero position', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:40.000,25.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().jogToMachinePosition(0, 0, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X-40.000 Y-25.000 F1000\n',
    ]);
  });

  it('does nothing when already at the target', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().jogToMachinePosition(12, 34, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([]);
  });

  it('lifts Z to the CNC safe height before the XY traverse, then jogs (F105)', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    const machine = useStore.getState().project.machine;
    const safeZMm = machine?.kind === 'cnc' ? machine.params.safeZMm : 0;
    const state = useLaserStore.getState();
    useLaserStore.setState({
      workZZeroEvidence: captureWorkZZeroEvidence('manual-zero', state.workZReferenceEpoch),
    });
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().jogToMachinePosition(120, 80, 1000);

    // The safe-Z retract is queued before the XY move so the bit clears stock.
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      `$J=G90 G21 Z${safeZMm.toFixed(3)} F1000\n`,
      '$J=G91 G21 X70.000 Y50.000 F1000\n',
    ]);
  });

  it('writes nothing when a CNC point move lacks current Work-Z evidence', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useStore.getState().setMachineKind('cnc');
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    writes.length = 0;

    await expect(useLaserStore.getState().jogToMachinePosition(120, 80, 1000)).rejects.toThrow(
      /work z/i,
    );

    expect(writes).toEqual([]);
  });

  it('does not add a Z retract for a laser project', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:50.000,30.000,0.000|FS:0,0>');
    writes.length = 0;

    await useLaserStore.getState().jogToMachinePosition(120, 80, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X70.000 Y50.000 F1000\n',
    ]);
  });

  it('errors without a live machine position', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    // No status report emitted → no known position.

    await expect(useLaserStore.getState().jogToMachinePosition(10, 10, 1000)).rejects.toThrow(
      /live machine position/i,
    );
    expect(useLaserStore.getState().lastWriteError).toMatch(/live machine position/i);
  });
});

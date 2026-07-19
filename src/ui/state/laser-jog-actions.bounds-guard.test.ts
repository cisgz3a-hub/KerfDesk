import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

describe('jog configured-machine-bounds guard', () => {
  afterEach(async () => {
    await useLaserStore.getState().disconnect();
    useStore.setState({ project: createProject(DEFAULT_DEVICE_PROFILE) });
    useLaserStore.setState({
      connection: { kind: 'disconnected' },
      statusReport: null,
      lastWriteError: null,
      motionOperation: null,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    vi.restoreAllMocks();
  });

  it('rejects an absolute board-point destination beyond configured travel', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => void writes.push(data));
    configureDevice('rear-left');
    await connectIdleAt(connection, 50, 50);
    writes.length = 0;

    await expect(useLaserStore.getState().jogToMachinePosition(401, 50, 1000)).rejects.toThrow(
      /outside the configured machine bounds/i,
    );

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([]);
    expect(useLaserStore.getState().lastWriteError).toMatch(/X0\.000\.\.400\.000/);
  });

  it('rejects a relative fine step past the edge but allows the exact edge', async () => {
    const rejectedWrites: string[] = [];
    const rejectedConnection = makeConnection(async (data) => void rejectedWrites.push(data));
    configureDevice('rear-left');
    await connectIdleAt(rejectedConnection, 399.5, 50);
    rejectedWrites.length = 0;

    await expect(useLaserStore.getState().jog({ dx: 1, feed: 1000 })).rejects.toThrow(
      /outside the configured machine bounds/i,
    );
    expect(rejectedWrites.filter((line) => line.startsWith('$J='))).toEqual([]);

    await useLaserStore.getState().disconnect();
    const allowedWrites: string[] = [];
    const allowedConnection = makeConnection(async (data) => void allowedWrites.push(data));
    await connectIdleAt(allowedConnection, 399.5, 50);
    allowedWrites.length = 0;
    await useLaserStore.getState().jog({ dx: 0.5, feed: 1000 });
    expect(allowedWrites.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X0.500 F1000\n',
    ]);
  });

  it('uses signed travel limits for a center-origin device', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => void writes.push(data));
    configureDevice('center');
    await connectIdleAt(connection, 0, 0);
    writes.length = 0;

    await expect(useLaserStore.getState().jogToMachinePosition(201, 0, 1000)).rejects.toThrow(
      /outside the configured machine bounds/i,
    );
    await useLaserStore.getState().jogToMachinePosition(-200, 0, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X-200.000 F1000\n',
    ]);
  });

  it('treats relative:false axes as the absolute destination', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => void writes.push(data));
    configureDevice('rear-left');
    await connectIdleAt(connection, 50, 50);
    writes.length = 0;

    await expect(
      useLaserStore.getState().jog({ dx: 401, dy: 50, feed: 1000, relative: false }),
    ).rejects.toThrow(/outside the configured machine bounds/i);
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([]);
  });
});

function configureDevice(origin: 'rear-left' | 'center'): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, origin, bedWidth: 400, bedHeight: 300, noGoZones: [] },
    },
  });
}

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

async function connectIdleAt(connection: FakeConnection, x: number, y: number): Promise<void> {
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
  connection.emitLine(`<Idle|MPos:${x.toFixed(3)},${y.toFixed(3)},0.000|FS:0,0>`);
  await flush();
  connection.emitLine('ok');
  connection.emitLine(`<Idle|MPos:${x.toFixed(3)},${y.toFixed(3)},0.000|FS:0,0>`);
  await flush();
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

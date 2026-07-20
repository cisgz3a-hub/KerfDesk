import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { DEFAULT_DEVICE_PROFILE, type NoGoZone } from '../../core/devices';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';
import { useStore } from './store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

function makeConnection(write: (data: string) => Promise<void>): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emitLine = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      respondToTestGrblHandshake(data, emitLine);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
    emitLine,
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
  } as unknown as PlatformAdapter;
}

const CLAMP: NoGoZone = {
  id: 'clamp',
  name: 'Left clamp',
  enabled: true,
  x: 20,
  y: 20,
  width: 20,
  height: 20,
};

function setZone(zone: NoGoZone): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, device: { ...project.device, noGoZones: [zone] } },
  });
}

async function connectIdleAtOrigin(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await settleTestGrblHandshake();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  setZone(CLAMP);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  // Reset the whole project (device included) so the injected zone can't leak.
  useStore.setState({ project: createProject(DEFAULT_DEVICE_PROFILE) });
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    lastWriteError: null,
    motionOperation: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
  vi.restoreAllMocks();
});

describe('jog no-go zone guard (DEV-04)', () => {
  it('refuses a jog whose path crosses an enabled zone and sends nothing', async () => {
    const writes: string[] = [];
    await connectIdleAtOrigin(makeConnection(async (data) => void writes.push(data)));
    writes.length = 0;

    // From (0,0) toward (50,50): the straight path cuts through the clamp (20..40).
    await expect(useLaserStore.getState().jogToMachinePosition(50, 50, 1000)).rejects.toThrow(
      /no-go zone "Left clamp"/i,
    );
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([]);
    expect(useLaserStore.getState().lastWriteError).toMatch(/Left clamp/);
  });

  it('allows a jog that stays clear of the zone', async () => {
    const writes: string[] = [];
    await connectIdleAtOrigin(makeConnection(async (data) => void writes.push(data)));
    writes.length = 0;

    // From (0,0) to (10,5): nowhere near the clamp.
    await useLaserStore.getState().jogToMachinePosition(10, 5, 1000);
    expect(writes.filter((line) => line.startsWith('$J=')).length).toBe(1);
  });

  it('allows a Z-only jog even when the head is parked inside a zone', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => void writes.push(data));
    await useLaserStore.getState().connect(makeAdapter(connection));
    connection.emitLine('Grbl 1.1f');
    connection.emitLine('<Idle|MPos:30.000,30.000,0.000|FS:0,0>');
    await flush();
    connection.emitLine('ok');
    // Park the head at (30,30) — inside the clamp (20..40).
    connection.emitLine('<Idle|MPos:30.000,30.000,0.000|FS:0,0>');
    await settleTestGrblHandshake();
    writes.length = 0;

    // A Z-only retract has no XY motion, so an XY keep-out cannot block it.
    await useLaserStore.getState().jog({ dz: 5, feed: 600 });
    expect(writes.filter((line) => line.startsWith('$J=')).length).toBe(1);
  });

  it('checks an absolute jog as a destination instead of a relative delta', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => void writes.push(data));
    await useLaserStore.getState().connect(makeAdapter(connection));
    connection.emitLine('Grbl 1.1f');
    connection.emitLine('<Idle|MPos:50.000,50.000,0.000|FS:0,0>');
    await flush();
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:50.000,50.000,0.000|FS:0,0>');
    await settleTestGrblHandshake();
    writes.length = 0;

    await expect(
      useLaserStore.getState().jog({ dx: 10, dy: 10, feed: 1000, relative: false }),
    ).rejects.toThrow(/no-go zone "Left clamp"/i);
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([]);
  });
});

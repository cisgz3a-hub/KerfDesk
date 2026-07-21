import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake, settleTestGrblHandshake } from './laser-test-start-helpers';
import { useStore } from './store';
import { useToastStore } from './toast-store';

type FakeConnection = SerialConnection & { readonly emitLine: (line: string) => void };

// ADR-232 / CLAUDE.md rule 7: configured machine bounds are warn-only policy.
// A jog whose target lies outside the configured bounds must still be sent to
// the controller (soft-limits remain the real bounds authority) with a
// non-blocking warning toast naming the bounds.
describe('jog configured-machine-bounds warning', () => {
  afterEach(async () => {
    await useLaserStore.getState().disconnect();
    useStore.setState({ project: createProject(DEFAULT_DEVICE_PROFILE) });
    useLaserStore.setState({
      connection: { kind: 'disconnected' },
      statusReport: null,
      lastWriteError: null,
      motionOperation: null,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    dismissAllToasts();
    vi.restoreAllMocks();
  });

  it('sends an absolute board-point destination beyond configured travel and warns', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => void writes.push(data));
    configureDevice('rear-left');
    await connectIdleAt(connection, 50, 50);
    writes.length = 0;

    await useLaserStore.getState().jogToMachinePosition(401, 50, 1000);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X351.000 F1000\n',
    ]);
    const warning = useToastStore.getState().toasts.at(-1);
    expect(warning?.variant).toBe('warning');
    expect(warning?.message).toMatch(/outside the configured machine bounds/i);
    expect(warning?.message).toMatch(/X0\.000\.\.400\.000/);
    expect(useLaserStore.getState().lastWriteError).toBeNull();
  });

  it('sends a relative fine step past the edge with a warning, and the edge silently', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => void writes.push(data));
    configureDevice('rear-left');
    await connectIdleAt(connection, 399.5, 50);
    writes.length = 0;

    await useLaserStore.getState().jog({ dx: 1, feed: 1000 });
    expect(writes.filter((line) => line.startsWith('$J='))).toEqual(['$J=G91 G21 X1.000 F1000\n']);
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('warning');
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(
      /outside the configured machine bounds/i,
    );

    await useLaserStore.getState().disconnect();
    dismissAllToasts();
    const edgeWrites: string[] = [];
    const edgeConnection = makeConnection(async (data) => void edgeWrites.push(data));
    await connectIdleAt(edgeConnection, 399.5, 50);
    edgeWrites.length = 0;
    await useLaserStore.getState().jog({ dx: 0.5, feed: 1000 });
    expect(edgeWrites.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X0.500 F1000\n',
    ]);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('warns with signed travel limits for a center-origin device', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => void writes.push(data));
    configureDevice('center');
    await connectIdleAt(connection, 0, 0);
    writes.length = 0;

    await useLaserStore.getState().jogToMachinePosition(201, 0, 1000);
    expect(useToastStore.getState().toasts.at(-1)?.message).toMatch(/X-200\.000\.\.200\.000/);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G91 G21 X201.000 F1000\n',
    ]);
  });

  it('treats relative:false axes as the absolute destination and still proceeds', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => void writes.push(data));
    configureDevice('rear-left');
    await connectIdleAt(connection, 50, 50);
    writes.length = 0;

    await useLaserStore.getState().jog({ dx: 401, dy: 50, feed: 1000, relative: false });

    expect(writes.filter((line) => line.startsWith('$J=')).length).toBe(1);
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('warning');
  });
});

function dismissAllToasts(): void {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
}

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
  await settleTestGrblHandshake();
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

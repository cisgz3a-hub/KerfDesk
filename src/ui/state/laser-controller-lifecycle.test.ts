import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
};

type ControllerOperationSnapshot = {
  readonly kind: string;
  readonly phase?: string;
  readonly idleReports?: number;
} | null;

function makeConnection(
  write: (data: string) => Promise<void>,
  autoModalResponse = true,
): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      await write(data);
      if (data === '$I\n') {
        emit('[VER:1.1f.20170801:test]');
        emit('[OPT:VM,15,128]');
        emit('ok');
      }
      if (data === '$G\n' && autoModalResponse) {
        emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emit('ok');
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

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function controllerOperation(): ControllerOperationSnapshot {
  return (
    (useLaserStore.getState() as { readonly controllerOperation?: ControllerOperationSnapshot })
      .controllerOperation ?? null
  );
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  useLaserStore.setState({ autofocusBusy: false });
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    autofocusBusy: false,
    motionOperation: null,
    streamer: null,
    log: [],
    transcript: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    frameVerification: null,
    homingState: 'unknown',
  });
  vi.restoreAllMocks();
});

describe('laser controller lifecycle operations', () => {
  it('keeps Home busy until command ack, settle marker ack, and fresh Idle arrive', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({
      alarmCode: 3,
      workOriginActive: true,
      wcoCache: { x: 12, y: 34, z: 0 },
      frameVerification: {
        boundsSignature: '0,0,10,10',
        wco: { x: 12, y: 34, z: 0 },
        workOriginActive: true,
      },
    });
    writes.length = 0;

    const home = useLaserStore.getState().home();
    await flush();

    expect(writes).toEqual(['$H\n']);
    expect(controllerOperation()).toMatchObject({ kind: 'home' });
    expect(useLaserStore.getState().homingState).toBe('homing');
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().homingState).toBe('homing');
    await expect(useLaserStore.getState().jog({ dx: 1, feed: 1000 })).rejects.toThrow(
      /controller operation/i,
    );
    await expect(useLaserStore.getState().sendConsoleCommand('$I')).rejects.toThrow(
      /controller operation/i,
    );

    connection.emitLine('ok');
    await flush();
    expect(writes).toEqual(['$H\n', 'G4 P0.01\n']);
    expect(controllerOperation()).toMatchObject({ kind: 'home', phase: 'settling' });

    connection.emitLine('ok');
    await flush();
    expect(controllerOperation()).toMatchObject({ kind: 'home', phase: 'awaiting-idle' });

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await home;

    expect(controllerOperation()).toBeNull();
    expect(useLaserStore.getState().homingState).toBe('confirmed');
    expect(useLaserStore.getState().alarmCode).toBeNull();
  });

  it('tracks the operator-selected active WCS from console commands (C6)', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    expect(useLaserStore.getState().activeWcs).toBeNull();

    const idle = (): void => {
      connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    };
    idle();
    await flush();
    const selectG55 = useLaserStore.getState().sendConsoleCommand('G55');
    await flush();
    connection.emitLine('ok');
    idle();
    await selectG55;
    expect(useLaserStore.getState().activeWcs).toBe('G55');

    idle();
    await flush();
    const selectG54 = useLaserStore.getState().sendConsoleCommand('G54');
    await flush();
    connection.emitLine('ok');
    idle();
    await selectG54;
    expect(useLaserStore.getState().activeWcs).toBe('G54');
  });

  it('reads the active WCS at connect via an owed-ack $G that never strands the fence (C6)', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    }, false);
    // A fully-qualifying connect (real settings rows) issues the modal query.
    await useLaserStore.getState().connect(makeAdapter(connection));
    connection.emitLine('Grbl 1.1f');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    connection.emitLine('$30=1000');
    connection.emitLine('$32=1');
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    await flush();

    // The controller was left in G55 by a $N startup block / another sender.
    expect(writes).toContain('$G\n');
    connection.emitLine('[GC:G0 G55 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
    connection.emitLine('ok'); // the $G ok — owed and settled, so the fence ends at zero
    await flush();
    expect(useLaserStore.getState().activeWcs).toBe('G55');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);

    // A later console command still gets its own ok — no stranded fence.
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    const selectG54 = useLaserStore.getState().sendConsoleCommand('G54');
    await flush();
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await selectG54;
    expect(useLaserStore.getState().activeWcs).toBe('G54');
  });

  it('keeps a completed job locked until the internal settle marker and stable Idle finish', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    await startTestLaserJob('G21\nG90\nM3 S0\nG1 X10 F600 S100\nM5\n');
    for (let i = 0; i < 5; i += 1) connection.emitLine('ok');
    await flush();

    expect(useLaserStore.getState().streamer?.status).toBe('done');
    expect(controllerOperation()).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });
    expect(writes.at(-1)).toBe('G4 P0.01\n');

    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().streamer?.status).toBe('done');

    connection.emitLine('ok');
    await flush();
    expect(controllerOperation()).toMatchObject({
      kind: 'post-job-settle',
      phase: 'awaiting-idle',
    });
    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    expect(useLaserStore.getState().streamer?.status).toBe('done');

    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await flush();

    expect(useLaserStore.getState().streamer).toBeNull();
    expect(controllerOperation()).toBeNull();
  });

  it('ignores a stray ok before the post-job settle marker write is confirmed', async () => {
    const writes: string[] = [];
    let settleWriteResolved = false;
    let resolveSettleWrite = (): void => {
      throw new Error('Settle marker write was not started.');
    };
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === 'G4 P0.01\n') {
        await new Promise<void>((resolve) => {
          resolveSettleWrite = () => {
            settleWriteResolved = true;
            resolve();
          };
        });
      }
    });
    await connectWith(connection);
    writes.length = 0;

    await startTestLaserJob('G21\nG90\nM3 S0\nG1 X10 F600 S100\nM5\n');
    for (let i = 0; i < 5; i += 1) connection.emitLine('ok');
    await flush();

    expect(useLaserStore.getState().streamer?.status).toBe('done');
    expect(controllerOperation()).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });
    expect(writes.at(-1)).toBe('G4 P0.01\n');
    expect(settleWriteResolved).toBe(false);

    connection.emitLine('ok');
    await flush();

    expect(controllerOperation()).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });
    expect(useLaserStore.getState().streamer?.status).toBe('done');

    resolveSettleWrite();
    await flush();
    connection.emitLine('ok');
    await flush();

    expect(controllerOperation()).toMatchObject({
      kind: 'post-job-settle',
      phase: 'awaiting-idle',
    });

    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    connection.emitLine('<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await flush();

    expect(useLaserStore.getState().streamer).toBeNull();
    expect(controllerOperation()).toBeNull();
  });
});

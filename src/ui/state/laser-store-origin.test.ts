import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly listenerCount: () => number;
};

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

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

async function acknowledge(connection: FakeConnection, action: Promise<void>): Promise<void> {
  await flush();
  connection.emitLine('ok');
  await action;
}

async function acknowledgeTwoLines(
  connection: FakeConnection,
  action: Promise<void>,
): Promise<void> {
  await flush();
  connection.emitLine('ok');
  await flush();
  connection.emitLine('ok');
  await action;
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
    streamer: null,
    log: [],
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroKnown: false,
    frameVerification: null,
    controllerOperation: null,
    pendingUntrackedAcks: 0,
  });
  vi.restoreAllMocks();
});

describe('laser-store origin actions', () => {
  it('rejects Set Origin when the G92 write fails', async () => {
    const write = vi.fn(async () => {
      throw new Error('origin rejected');
    });
    const connection = makeConnection(write);
    await connectWith(connection);

    await expect(useLaserStore.getState().setOriginHere()).rejects.toThrow('origin rejected');
    expect(useLaserStore.getState().log.join('\n')).toContain(
      'Serial write failed: origin rejected',
    );
  });

  it('marks the work origin active only after the controller acknowledges Set Origin', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');

    const action = useLaserStore.getState().setOriginHere();
    await flush();

    expect(write).toHaveBeenCalledWith('G92 X0 Y0\n');
    expect(connection.listenerCount()).toBe(1);
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'interactive-command',
      label: 'Set work origin',
    });
    await expect(useLaserStore.getState().sendConsoleCommand('$I')).rejects.toThrow(
      /controller operation/i,
    );
    await expect(useLaserStore.getState().startJob('G21\nG90\nM5\n')).rejects.toThrow(
      /controller operation/i,
    );

    connection.emitLine('ok');
    await action;

    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('g92');
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 12, y: 34, z: 0 });
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('does not finish Set Origin until the machine location is captured (post-Release/Wake)', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    // Post-$SLP-wake state: Idle (so the Idle-gate passes) but WPos-only with no
    // cached WCO, so the machine location cannot be inferred yet — the exact state
    // where the origin would otherwise record active-but-location-unknown (wcoCache
    // null → Start refuses it until a jog forces a fresh frame; the reported bug).
    connection.emitLine('<Idle|WPos:5.000,6.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().wcoCache).toBeNull();

    let settled = false;
    const action = useLaserStore
      .getState()
      .setOriginHere()
      .then(() => {
        settled = true;
      });
    await flush();
    connection.emitLine('ok'); // G92 acknowledged
    await flush();

    // The G92 is acknowledged, but the location is still unknown (no MPos/WCO frame
    // yet). Set Origin must NOT finish having recorded an unusable origin — it waits.
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(settled).toBe(false);

    // GRBL reports the new WCO after the G92 (a G92 does not move the head, so this
    // is the head's true location):
    connection.emitLine('<Idle|MPos:5.000,6.000,0.000|WCO:5.000,6.000,0.000|FS:0,0>');
    await action;

    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('g92');
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 5, y: 6, z: 0 });
  });

  it('Set Origin (XY) does not establish work Z0, but Zero Z does (Codex audit P1)', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');

    // G92 X0 Y0 sets the XY origin but never touches Z — the CNC no-work-zero
    // advisory (which keys on workZZeroKnown) must stay live.
    await acknowledge(connection, useLaserStore.getState().setOriginHere());
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workZZeroKnown).toBe(false);

    // Zero Z (G92 Z0) is what establishes the stock-top contract.
    const zeroZ = useLaserStore.getState().zeroZHere();
    await flush();
    expect(write).toHaveBeenCalledWith('G92 Z0\n');
    expect(useLaserStore.getState().workZZeroKnown).toBe(false);
    connection.emitLine('ok');
    await zeroZ;
    expect(useLaserStore.getState().workZZeroKnown).toBe(true);
  });

  it('marks the work origin persistent after advanced Set Persistent Origin succeeds', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');
    useLaserStore.setState({
      frameVerification: {
        boundsSignature: 'old',
        wco: { x: 12, y: 34, z: 0 },
        workOriginActive: true,
      },
    });

    const action = useLaserStore.getState().setPersistentOriginHere();
    await flush();

    expect(write).toHaveBeenCalledWith('G92.1\n');
    expect(write).not.toHaveBeenCalledWith('G10 L20 P1 X0 Y0\n');
    expect(useLaserStore.getState().workOriginSource).toBe('none');
    connection.emitLine('ok');
    await flush();
    expect(write).toHaveBeenCalledWith('G10 L20 P1 X0 Y0\n');
    expect(useLaserStore.getState().workOriginSource).toBe('none');
    connection.emitLine('ok');
    await action;

    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('g54-persistent');
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 12, y: 34, z: 0 });
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });

  it('requires an Idle status before advanced persistent origin writes', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Run|MPos:12.000,34.000,0.000|FS:0,0>');

    await expect(useLaserStore.getState().setPersistentOriginHere()).rejects.toThrow(
      /Machine must be Idle/i,
    );

    expect(write).not.toHaveBeenCalledWith('G10 L20 P1 X0 Y0\n');
  });

  it('clears the active work-origin flag when Reset Origin succeeds', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g92',
      wcoCache: { x: 12, y: 34, z: 0 },
    });

    await acknowledge(connection, useLaserStore.getState().resetOrigin());

    expect(write).toHaveBeenCalledWith('G92.1\n');
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().workOriginSource).toBe('none');
    expect(useLaserStore.getState().wcoCache).toBeNull();
  });

  it('does not pretend Reset Origin cleared a known persistent G54 origin', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g54-persistent',
      wcoCache: { x: 12, y: 34, z: 0 },
    });

    await acknowledge(connection, useLaserStore.getState().resetOrigin());

    expect(write).toHaveBeenCalledWith('G92.1\n');
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('g54-persistent');
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 12, y: 34, z: 0 });
  });

  it('clears persistent G54 origin through the advanced clear action', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g54-persistent',
      wcoCache: { x: 12, y: 34, z: 0 },
      frameVerification: {
        boundsSignature: 'old',
        wco: { x: 12, y: 34, z: 0 },
        workOriginActive: true,
      },
    });

    await acknowledgeTwoLines(connection, useLaserStore.getState().clearPersistentOrigin());

    expect(write).toHaveBeenCalledWith('G92.1\n');
    expect(write).toHaveBeenCalledWith('G10 L2 P1 X0 Y0\n');
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().workOriginSource).toBe('none');
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });

  it('invalidates origin truth when a persistent-origin transaction fails after G92 clears', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroKnown: true,
      wcoCache: { x: 12, y: 34, z: 5 },
    });

    const action = useLaserStore.getState().setPersistentOriginHere();
    await flush();
    expect(writes).toEqual(['G92.1\n']);
    connection.emitLine('ok');
    await flush();
    expect(writes).toEqual(['G92.1\n', 'G10 L20 P1 X0 Y0\n']);
    connection.emitLine('error:20');

    await expect(action).rejects.toThrow(/error:20/i);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('unknown');
    expect(useLaserStore.getState().workZZeroKnown).toBe(false);
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'controller-error',
      code: 20,
      rejectedLine: 'G10 L20 P1 X0 Y0',
    });
  });

  it('requires a known Idle state and no outstanding acknowledgement', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);

    useLaserStore.setState({ statusReport: null });
    await expect(useLaserStore.getState().setOriginHere()).rejects.toThrow(/currently unknown/i);
    expect(write).not.toHaveBeenCalledWith('G92 X0 Y0\n');

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
    await expect(useLaserStore.getState().zeroZHere()).rejects.toThrow(/acknowledged/i);
    expect(write).not.toHaveBeenCalledWith('G92 Z0\n');
  });
});

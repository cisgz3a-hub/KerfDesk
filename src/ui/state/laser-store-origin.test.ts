import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
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
  await Promise.resolve();
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
    frameVerification: null,
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

  it('marks the work origin active immediately after Set Origin succeeds', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');

    await useLaserStore.getState().setOriginHere();

    expect(write).toHaveBeenCalledWith('G92 X0 Y0\n');
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('g92');
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 12, y: 34, z: 0 });
  });

  it('Set Origin (XY) does not establish work Z0, but Zero Z does (Codex audit P1)', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');

    // G92 X0 Y0 sets the XY origin but never touches Z — the CNC no-work-zero
    // advisory (which keys on workZZeroKnown) must stay live.
    await useLaserStore.getState().setOriginHere();
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workZZeroKnown).toBe(false);

    // Zero Z (G92 Z0) is what establishes the stock-top contract.
    await useLaserStore.getState().zeroZHere();
    expect(write).toHaveBeenCalledWith('G92 Z0\n');
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

    await useLaserStore.getState().setPersistentOriginHere();

    expect(write).toHaveBeenCalledWith('G92.1\n');
    expect(write).toHaveBeenCalledWith('G10 L20 P1 X0 Y0\n');
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

    await useLaserStore.getState().resetOrigin();

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

    await useLaserStore.getState().resetOrigin();

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

    await useLaserStore.getState().clearPersistentOrigin();

    expect(write).toHaveBeenCalledWith('G92.1\n');
    expect(write).toHaveBeenCalledWith('G10 L2 P1 X0 Y0\n');
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().workOriginSource).toBe('none');
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

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
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
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
    workOriginVersion: 0,
    workZZeroEvidence: null,
    frameVerification: null,
    controllerOperation: null,
    pendingUntrackedAcks: 0,
  });
  useStore.setState({ project: createProject() });
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

    expect(write).toHaveBeenCalledWith('G54 G92 X0 Y0\n');
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
    // Set Origin now waits for the post-G92 work-offset report before finishing,
    // so the origin is usable the moment it completes — the Z still comes from this
    // real frame, never fabricated from MPos.z.
    connection.emitLine('<Idle|WPos:0.000,0.000,0.000|WCO:12.000,34.000,0.000|FS:0,0>');
    await action;

    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('g92');
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 12, y: 34, z: 0 });
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it('does not finish Set Origin until the work offset is known (post-Release/Wake)', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    // Idle but no WCO frame yet → wcoCache null. The no-homing hand-set workflow:
    // Release motors → hand-move → Wake → Set origin, before any WCO frame lands.
    // transientXyOriginPatch declines to fabricate the offset, so Set origin would
    // leave wcoCache null and Start would refuse the origin as location-unknown
    // until a jog forced a WCO frame — the reported bug.
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');
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

    // Acknowledged, but the offset is still unknown — Set origin must keep waiting,
    // not finish having recorded a location-unknown origin.
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(settled).toBe(false);

    // A full-WCS controller reports the new WCO after the G92 (emitted regardless
    // of homing). A G92 does not move the head, so this is its true location.
    connection.emitLine('<Idle|WPos:0.000,0.000,0.000|WCO:12.000,34.000,0.000|FS:0,0>');
    await action;

    expect(settled).toBe(true);
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('g92');
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 12, y: 34, z: 0 });
    // A fresh work offset landed, so the origin is confirmed — no B21 warning.
    expect(useLaserStore.getState().log.join('\n')).not.toContain('location is unconfirmed');
  });

  it('warns that the origin is unconfirmed when no work offset arrives (B21)', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().wcoCache).toBeNull();

    vi.useFakeTimers();
    try {
      let settled = false;
      const action = useLaserStore
        .getState()
        .setOriginHere()
        .then(() => {
          settled = true;
        });
      await vi.advanceTimersByTimeAsync(0);
      connection.emitLine('ok'); // G92 acknowledged, but no WCO frame follows
      // Blow past the 3s work-offset wait without ever reporting a fresh WCO.
      await vi.advanceTimersByTimeAsync(3_100);
      await action;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }

    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().wcoCache).toBeNull();
    expect(useLaserStore.getState().log.join('\n')).toContain('location is unconfirmed');
  });

  it('keeps a hand-set origin active when its offset is zero (machine 0,0 after Wake)', async () => {
    // No-homing workflow: Release motors -> hand-move -> Wake leaves GRBL at
    // machine 0,0, so Set origin here (G92 X0 Y0) yields a WCO of exactly zero.
    // That is a deliberate origin; a routine zero-WCO status frame must not clear
    // it (the reported "set origin after release motors doesn't work").
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();

    const action = useLaserStore.getState().setOriginHere();
    await flush();
    connection.emitLine('ok');
    connection.emitLine('<Idle|WPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
    await action;
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('g92');

    // A later routine status frame still carrying the zero WCO must not demote it.
    connection.emitLine('<Idle|WPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('g92');
  });

  it('does not treat a zero WCO as a custom origin when none was set', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    // Fresh connection, no origin action: a zero WCO stays "machine 0,0".
    connection.emitLine('<Idle|WPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().workOriginSource).toBe('none');
  });

  it('preserves a known Z offset when Set Origin changes X/Y only', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,5.000|FS:0,0>');
    useLaserStore.setState({
      wcoCache: { x: 1, y: 2, z: 7 },
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0 },
    });

    await acknowledge(connection, useLaserStore.getState().setOriginHere());

    expect(useLaserStore.getState().wcoCache).toEqual({ x: 12, y: 34, z: 7 });
    expect(useLaserStore.getState().workZZeroEvidence).not.toBeNull();
  });

  it('Set Origin (XY) does not establish work Z0, but Zero Z does (Codex audit P1)', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');
    const originVersionBefore = useLaserStore.getState().workOriginVersion ?? 0;

    // G92 X0 Y0 sets the XY origin but never touches Z — the CNC no-work-zero
    // advisory (which keys on workZZeroEvidence) must stay live.
    const setOrigin = useLaserStore.getState().setOriginHere();
    await flush();
    connection.emitLine('ok');
    connection.emitLine('<Idle|WPos:0.000,0.000,0.000|WCO:12.000,34.000,0.000|FS:0,0>');
    await setOrigin;
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().workOriginVersion).toBe(originVersionBefore + 1);

    // Zero Z (G92 Z0) is what establishes the stock-top contract.
    const zeroZ = useLaserStore.getState().zeroZHere();
    await flush();
    expect(write).toHaveBeenCalledWith('G54 G92 Z0\n');
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    connection.emitLine('ok');
    await zeroZ;
    expect(useLaserStore.getState().workZZeroEvidence).not.toBeNull();
    expect(useLaserStore.getState().workOriginVersion).toBe(originVersionBefore + 1);
  });

  it('marks the XY origin persistent but invalidates Z cleared by G92.1', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,0.000|FS:0,0>');
    useLaserStore.setState({
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0 },
      wcoCache: { x: 1, y: 2, z: 5 },
      frameVerification: {
        boundsSignature: 'old',
        wco: { x: 12, y: 34, z: 0 },
        workOriginActive: true,
      },
    });

    const action = useLaserStore.getState().setPersistentOriginHere();
    await flush();

    expect(write).toHaveBeenCalledWith('G54 G92.1\n');
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
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().wcoCache).toBeNull();
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
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0 },
      wcoCache: { x: 12, y: 34, z: 0 },
    });

    await acknowledge(connection, useLaserStore.getState().resetOrigin());

    expect(write).toHaveBeenCalledWith('G54 G92.1\n');
    expect(useLaserStore.getState().workOriginActive).toBe(false);
    expect(useLaserStore.getState().workOriginSource).toBe('none');
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().wcoCache).toBeNull();
  });

  it('does not pretend Reset Origin cleared a known persistent G54 origin', async () => {
    const write = vi.fn<(data: string) => Promise<void>>(async () => undefined);
    const connection = makeConnection(write);
    await connectWith(connection);
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g54-persistent',
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0 },
      wcoCache: { x: 12, y: 34, z: 5 },
    });

    await acknowledge(connection, useLaserStore.getState().resetOrigin());

    expect(write).toHaveBeenCalledWith('G54 G92.1\n');
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('g54-persistent');
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().wcoCache).toBeNull();
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

    expect(write).toHaveBeenCalledWith('G54 G92.1\n');
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
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0 },
      wcoCache: { x: 12, y: 34, z: 5 },
    });

    const action = useLaserStore.getState().setPersistentOriginHere();
    await flush();
    expect(writes).toEqual(['G54 G92.1\n']);
    connection.emitLine('ok');
    await flush();
    expect(writes).toEqual(['G54 G92.1\n', 'G10 L20 P1 X0 Y0\n']);
    connection.emitLine('error:20');

    await expect(action).rejects.toThrow(/error:20/i);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().workOriginSource).toBe('unknown');
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
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
    expect(write).not.toHaveBeenCalledWith('G54 G92 X0 Y0\n');

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    useLaserStore.setState({ pendingUntrackedAcks: 1 });
    await expect(useLaserStore.getState().zeroZHere()).rejects.toThrow(/acknowledged/i);
    expect(write).not.toHaveBeenCalledWith('G54 G92 Z0\n');
  });
});

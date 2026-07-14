import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_HOLD, RT_RESUME } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { cncControllerEpochOf, createCncSetupAttestation } from './cnc-setup-attestation';
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
      requestPort: async () => ({
        open: async () => connection,
      }),
    },
  };
}

async function connectWith(connection: FakeConnection): Promise<void> {
  await useLaserStore.getState().connect(makeAdapter(connection));
  connection.emitLine('Grbl 1.1f');
  // Let the handshake's $$ write land, then ack it like real GRBL does —
  // startJob waits for owed untracked acks to drain.
  await flushConnect();
  connection.emitLine('ok');
  await flushConnect();
}

async function flushConnect(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
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
    detectedSettings: null,
    controllerSettings: null,
    wcoCache: null,
    workOriginActive: false,
  });
  vi.restoreAllMocks();
});

describe('laser-store pause safety', () => {
  it('refuses feed-hold pause when GRBL laser mode is not confirmed on', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1 S100\nM5\n');
    writes.length = 0;

    await expect(useLaserStore.getState().pauseJob()).rejects.toThrow(/\$32=1/);

    expect(writes).not.toContain(RT_HOLD);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(useLaserStore.getState().lastWriteError).toMatch(/\$32=1/);
  });

  it('allows feed-hold pause for a CNC job with laser mode off ($32=0 is router-correct)', async () => {
    // Feed hold on a spindle machine is safe (motion holds, spindle keeps
    // spinning — standard sender behavior); the $32 proof is a laser-only
    // requirement and must not block router pause.
    const writes: string[] = [];
    let liveConnection: FakeConnection | null = null;
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === 'G4 P0.01\n') {
        setTimeout(() => liveConnection?.emitLine('ok'), 0);
      }
      if (data === '?') {
        setTimeout(() => {
          liveConnection?.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
        }, 0);
      }
    });
    liveConnection = connection;
    await connectWith(connection);
    useLaserStore.setState({
      controllerSettings: { laserModeEnabled: false },
      accessoryCache: {
        spindleCw: false,
        spindleCcw: false,
        flood: false,
        mist: false,
      },
    });
    const gcode = 'G21\nG90\nM3 S12000\nG1 X1 F300\nM5\n';
    await useLaserStore.getState().startJob(gcode, {
      machineKind: 'cnc',
      cncSetupAttestation: createCncSetupAttestation(
        gcode,
        cncControllerEpochOf(useLaserStore.getState()),
      ),
    });
    writes.length = 0;

    await useLaserStore.getState().pauseJob();

    expect(writes).toContain(RT_HOLD);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
  });

  it('refuses CNC Resume without writing cycle-start or refilling the stream', async () => {
    const writes: string[] = [];
    let liveConnection: FakeConnection | null = null;
    const connection = makeConnection(async (data) => {
      writes.push(data);
      if (data === 'G4 P0.01\n') setTimeout(() => liveConnection?.emitLine('ok'), 0);
      if (data === '?') {
        setTimeout(() => {
          liveConnection?.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
        }, 0);
      }
    });
    liveConnection = connection;
    await connectWith(connection);
    useLaserStore.setState({
      controllerSettings: { laserModeEnabled: false },
      accessoryCache: {
        spindleCw: false,
        spindleCcw: false,
        flood: false,
        mist: false,
      },
    });
    const gcode = 'G21\nG90\nM3 S12000\nG1 X1 F300\nM5\n';
    await useLaserStore.getState().startJob(gcode, {
      machineKind: 'cnc',
      cncSetupAttestation: createCncSetupAttestation(
        gcode,
        cncControllerEpochOf(useLaserStore.getState()),
      ),
    });
    await useLaserStore.getState().pauseJob();
    writes.length = 0;

    await expect(useLaserStore.getState().resumeJob()).rejects.toThrow(/cannot prove.*spindle/i);

    expect(writes).not.toContain(RT_RESUME);
    expect(writes).toEqual([]);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
  });

  it('refuses feed-hold pause when GRBL reports laser mode disabled', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({ controllerSettings: { laserModeEnabled: false } });
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1 S100\nM5\n');
    writes.length = 0;

    await expect(useLaserStore.getState().pauseJob()).rejects.toThrow(/\$32=1/);

    expect(writes).not.toContain(RT_HOLD);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  });
});

describe('laser-store pause at end of stream', () => {
  // GRBL keeps acking held-but-parsed lines during a feed hold. Pausing near
  // the end of a job drains every ack while the machine still holds
  // unexecuted motion — the job must stay paused (Resume mounted), and Resume
  // must complete it through the normal Idle release.
  it('stays paused when the held tail acks out; resume completes the job at Idle', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({ controllerSettings: { laserModeEnabled: true } });
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1 S100\nM5\n');
    await useLaserStore.getState().pauseJob();
    expect(useLaserStore.getState().streamer?.status).toBe('paused');

    for (let i = 0; i < 5; i += 1) connection.emitLine('ok');
    await Promise.resolve();

    expect(useLaserStore.getState().streamer?.status).toBe('paused');

    await useLaserStore.getState().resumeJob();
    expect(useLaserStore.getState().streamer?.status).toBe('done');

    connection.emitLine('<Idle|MPos:1.000,0.000,0.000|FS:0,0>');
    await Promise.resolve();
    expect(useLaserStore.getState().streamer).toBeNull();
  });
});

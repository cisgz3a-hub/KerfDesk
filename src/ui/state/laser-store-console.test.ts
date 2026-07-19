import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { createFramedRunPermit, type FramedRunCandidate } from './framed-run';
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
  // Let the handshake's $$ write land, then ack it like real GRBL does —
  // startJob waits for owed untracked acks to drain.
  await flushConnect();
  connection.emitLine('ok');
  await flushConnect();
}

async function flushConnect(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function currentWorkZEvidence() {
  return {
    source: 'manual-zero' as const,
    referenceEpoch: useLaserStore.getState().workZReferenceEpoch,
  };
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
    accessoryCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroEvidence: null,
    frameVerification: null,
    framedRun: null,
    homingState: 'unknown',
    trustedPositionEpoch: 0,
  });
  vi.restoreAllMocks();
});

describe('laser-store console commands', () => {
  it('owns and confirms G54 before Frame can prepare against the canonical WCS', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({
      activeWcs: 'G55',
      workZZeroEvidence: currentWorkZEvidence(),
      framedRun: createFramedRunPermit({} as FramedRunCandidate, useLaserStore.getState()),
    });
    writes.length = 0;

    let settled = false;
    const selection = useLaserStore
      .getState()
      .selectPrimaryWcsForFrame()
      .then(() => {
        settled = true;
      });
    await flushConnect();

    expect(writes).toEqual(['G54\n']);
    expect(settled).toBe(false);
    expect(useLaserStore.getState().framedRun).toBeNull();

    connection.emitLine('ok');
    await selection;
    expect(useLaserStore.getState()).toMatchObject({
      activeWcs: 'G54',
      statusReport: null,
      workZZeroEvidence: null,
      framedRun: null,
    });
  });

  it('does not assume G54 when the controller rejects the owned selection', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    useLaserStore.setState({ activeWcs: 'G55' });

    const selection = useLaserStore.getState().selectPrimaryWcsForFrame();
    await flushConnect();
    connection.emitLine('error:20');

    await expect(selection).rejects.toThrow(/error:20/i);
    expect(useLaserStore.getState().activeWcs).toBe('G55');
  });

  it('records inbound and outbound controller traffic in the transcript', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.getState().clearTranscript();

    await useLaserStore.getState().sendConsoleCommand('$I');
    connection.emitLine('[VER:1.1f.20240101:]');

    expect(writes.at(-1)).toBe('$I\n');
    expect(useLaserStore.getState().transcript.map((entry) => entry.raw)).toEqual([
      '$I\n',
      '[VER:1.1f.20240101:]',
    ]);
    expect(useLaserStore.getState().transcript[0]).toMatchObject({
      direction: 'out',
      kind: 'build-info-query',
      source: 'console',
    });
  });

  it('refreshes detected settings when $$ is sent from the console', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({ detectedSettings: null, controllerSettings: null });

    await useLaserStore.getState().sendConsoleCommand('$$');
    for (const line of ['$30=1000', '$31=0', '$32=1', '$130=400', '$131=400', 'ok']) {
      connection.emitLine(line);
    }

    expect(writes.at(-1)).toBe('$$\n');
    expect(useLaserStore.getState().controllerSettings).toMatchObject({
      maxPowerS: 1000,
      minPowerS: 0,
      laserModeEnabled: true,
      bedWidth: 400,
      bedHeight: 400,
    });
  });

  it('preserves setup evidence for read-only console queries', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,5.000|WCO:12.000,34.000,5.000|FS:0,0>');
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 7 },
      workZReferenceEpoch: 7,
      wcoCache: { x: 12, y: 34, z: 5 },
      trustedPositionEpoch: 7,
    });

    await useLaserStore.getState().sendConsoleCommand('$#');

    expect(useLaserStore.getState()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 7 },
      workZReferenceEpoch: 7,
      wcoCache: { x: 12, y: 34, z: 5 },
      trustedPositionEpoch: 7,
      statusReport: { state: 'Idle' },
    });
  });

  it('requires fresh position after console motion without discarding work-zero authority', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,5.000|WCO:12.000,34.000,5.000|FS:0,0>');
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 7 },
      workZReferenceEpoch: 7,
      wcoCache: { x: 12, y: 34, z: 5 },
      frameVerification: {
        boundsSignature: '0,0,10,10',
        wco: { x: 12, y: 34, z: 5 },
        workOriginActive: true,
      },
      homingState: 'confirmed',
      trustedPositionEpoch: 7,
    });

    await useLaserStore.getState().sendConsoleCommand('G0 X10');

    expect(useLaserStore.getState()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 7 },
      workZReferenceEpoch: 7,
      wcoCache: { x: 12, y: 34, z: 5 },
      frameVerification: null,
      homingState: 'confirmed',
      statusReport: null,
      trustedPositionEpoch: 8,
    });
  });

  it('invalidates a known all-off cache after an accessory-mutating console command', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
    expect(useLaserStore.getState().accessoryCache).toEqual({
      spindleCw: false,
      spindleCcw: false,
      flood: false,
      mist: false,
    });

    await useLaserStore.getState().sendConsoleCommand('M3 S12000');
    expect(useLaserStore.getState().accessoryCache).toBeNull();

    // GRBL may return an ordinary Idle frame before its intermittent Ov:/A:
    // report. That frame must not resurrect the stale all-off observation.
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,12000>');
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    expect(useLaserStore.getState().accessoryCache).toBeNull();
  });

  it('does not revive a Frame permit after a manual accessory command and fresh Idle', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    const laser = useLaserStore.getState();
    // The candidate payload is irrelevant to this store-level invalidation test.
    const permit = createFramedRunPermit({} as FramedRunCandidate, laser);
    useLaserStore.setState({ framedRun: permit });

    await useLaserStore.getState().sendConsoleCommand('M3 S12000');
    expect(useLaserStore.getState().framedRun).toBeNull();

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,12000>');
    expect(useLaserStore.getState()).toMatchObject({
      statusReport: { state: 'Idle', mPos: { x: 0, y: 0, z: 0 } },
      framedRun: null,
    });
  });

  it('invalidates only XY setup truth for an XY-only console origin command', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,5.000|WCO:12.000,34.000,5.000|FS:0,0>');
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 7 },
      workZReferenceEpoch: 7,
      wcoCache: { x: 12, y: 34, z: 5 },
      frameVerification: {
        boundsSignature: '0,0,10,10',
        wco: { x: 12, y: 34, z: 5 },
        workOriginActive: true,
      },
      trustedPositionEpoch: 7,
    });

    await useLaserStore.getState().sendConsoleCommand('G92 X0 Y0');

    expect(useLaserStore.getState()).toMatchObject({
      workOriginActive: false,
      workOriginSource: 'none',
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 7 },
      workZReferenceEpoch: 7,
      wcoCache: null,
      frameVerification: null,
      statusReport: null,
      trustedPositionEpoch: 8,
    });
  });

  it('invalidates Z truth but preserves XY authority for a console tool-length change', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    connection.emitLine('<Idle|MPos:12.000,34.000,5.000|WCO:12.000,34.000,5.000|FS:0,0>');
    useLaserStore.setState({
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 7 },
      workZReferenceEpoch: 7,
      wcoCache: { x: 12, y: 34, z: 5 },
      trustedPositionEpoch: 7,
    });

    await useLaserStore.getState().sendConsoleCommand('G43.1 Z-12.5');

    expect(useLaserStore.getState()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: null,
      workZReferenceEpoch: 8,
      wcoCache: null,
      statusReport: null,
      trustedPositionEpoch: 8,
    });
  });

  it('blocks console commands during an active job except realtime status query', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    await useLaserStore.getState().startJob('G21\nG90\nM3 S0\nG1 X1\nM5\n');
    writes.length = 0;

    await expect(useLaserStore.getState().sendConsoleCommand('$I')).rejects.toThrow(
      /job is active/i,
    );
    await useLaserStore.getState().sendConsoleCommand('?');

    expect(writes).toEqual(['?']);
    expect(useLaserStore.getState().transcript.at(-1)).toMatchObject({
      raw: '?',
      source: 'console',
      kind: 'realtime',
    });
  });

  it('requires confirmation and Idle state while preserving position for non-positional settings', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    useLaserStore.setState({ statusReport: null, statusObservation: null });

    await expect(useLaserStore.getState().sendConsoleCommand('$32=1')).rejects.toThrow(
      /confirmation/i,
    );
    await expect(
      useLaserStore.getState().sendConsoleCommand('$32=1', { confirmed: true }),
    ).rejects.toThrow(/Idle status report/i);

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    useLaserStore.setState({
      controllerSettings: { laserModeEnabled: true },
      detectedSettings: { laserModeEnabled: true },
      grblSettingsRows: [
        {
          id: 32,
          code: '$32',
          rawValue: '1',
          numericValue: 1,
          name: 'Laser mode',
          unit: null,
          description: 'Laser mode enable',
          category: 'laser',
          known: true,
          writeRisk: 'common',
        },
      ],
      lastSettingsReadAt: 123,
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: currentWorkZEvidence(),
      wcoCache: { x: 1, y: 2, z: 3 },
      homingState: 'confirmed',
    });
    await useLaserStore.getState().sendConsoleCommand('$32=1', { confirmed: true });

    expect(writes.at(-1)).toBe('$32=1\n');
    expect(useLaserStore.getState()).toMatchObject({
      controllerSettings: null,
      detectedSettings: null,
      grblSettingsRows: [],
      lastSettingsReadAt: null,
      workOriginActive: true,
      workOriginSource: 'g92',
      workZZeroEvidence: currentWorkZEvidence(),
      wcoCache: { x: 1, y: 2, z: 3 },
      homingState: 'confirmed',
      statusReport: null,
    });
  });
});

describe('job stream transcript source', () => {
  // The console panel hides source 'job' entries unless "show stream" is on.
  // Ack-driven refills travel through the line handler's write wrapper — if
  // that path drops the source, every refill lands as 'system' and the
  // console floods with raw G-code during jobs.
  it('tags mid-job refill writes as job traffic end-to-end', async () => {
    const connection = makeConnection(async () => undefined);
    await connectWith(connection);
    connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await Promise.resolve();

    // Eight 29-byte lines: the 120-byte first window holds four; each ok
    // triggers a refill write for the next queued line.
    const longLine = 'G1 X99.000 Y99.000 F600 S255';
    await useLaserStore.getState().startJob(Array.from({ length: 8 }, () => longLine).join('\n'));
    connection.emitLine('ok');
    connection.emitLine('ok');
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    const outbound = useLaserStore
      .getState()
      .transcript.filter((e) => e.direction === 'out' && e.raw.startsWith('G1 X99'));
    // Initial window plus at least two refills.
    expect(outbound.length).toBeGreaterThanOrEqual(3);
    expect([...new Set(outbound.map((e) => e.source))]).toEqual(['job']);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsMapToRows } from '../../core/controllers/grbl';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { recoveryRepository } from './recovery';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

type FakeConnection = SerialConnection & {
  readonly emitLine: (line: string) => void;
  readonly forget: ReturnType<typeof vi.fn<() => Promise<void>>>;
};

function makeConnection(writes: string[]): FakeConnection {
  const lineHandlers = new Set<(line: string) => void>();
  const emit = (line: string): void => {
    for (const handler of lineHandlers) handler(line);
  };
  return {
    write: async (data) => {
      writes.push(data);
      // Real GRBL answers the connect-time $G modal query (C6) with its state
      // then ok; model it so the modal query settles during connect.
      if (data === '$G\n') {
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
    forget: vi.fn(async () => undefined),
    emitLine: (line) => emit(line),
  };
}

function adapter(connection: SerialConnection): PlatformAdapter {
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

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function settleTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 75));
  await flush();
}

async function connectQualified(
  connection: FakeConnection,
  settings: ReadonlyArray<string> = ['$30=1000', '$31=0', '$32=1'],
): Promise<void> {
  await useLaserStore.getState().connect(adapter(connection));
  connection.emitLine('Grbl 1.1f');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  for (const line of settings) connection.emitLine(line);
  connection.emitLine('ok');
  await flush();
  // Let the detached handshake issue its post-qualification $G (C6) and the
  // fake connection auto-reply settle before the test drives more I/O.
  await flush();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  localStorage.clear();
});

afterEach(async () => {
  useLaserStore.setState({ autofocusBusy: false });
  await useLaserStore.getState().disconnect();
  useStore.getState().newProject();
  vi.restoreAllMocks();
});

describe('epoch-bound controller qualification', () => {
  it('waits for fresh Idle and issues exactly one owned settings read', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await useLaserStore.getState().connect(adapter(connection));
    connection.emitLine('Grbl 1.1f');
    await flush();

    expect(writes).not.toContain('$$\n');
    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'qualifying',
      phase: 'reset-cleanup',
    });

    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    expect(writes.filter((line) => line === '$$\n')).toHaveLength(1);

    connection.emitLine('$30=1000');
    connection.emitLine('$31=0');
    connection.emitLine('$32=1');
    connection.emitLine('ok');
    await flush();

    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'qualified',
      settings: 'verified',
    });
    expect(writes.filter((line) => line === '$$\n')).toHaveLength(1);
  });

  it('keeps an empty settings read failed until the inline Retry succeeds', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await useLaserStore.getState().connect(adapter(connection));
    connection.emitLine('Grbl 1.1f');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await flush();
    connection.emitLine('ok');
    await flush();

    expect(useLaserStore.getState().controllerQualification).toMatchObject({ kind: 'failed' });
    const retry = useLaserStore.getState().retryControllerQualification();
    await flush();
    expect(writes.filter((line) => line === '$$\n')).toHaveLength(2);
    connection.emitLine('$30=1000');
    connection.emitLine('$32=1');
    connection.emitLine('ok');
    await retry;

    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'qualified',
      settings: 'verified',
    });
  });

  it.each(['read', 'write'] as const)(
    'does not let a stale settings %s failure poison a newer qualification epoch',
    async (operation) => {
      const writes: string[] = [];
      const connection = makeConnection(writes);
      await connectQualified(connection);
      const oldEpoch = useLaserStore.getState().controllerSessionEpoch;
      const pending =
        operation === 'read'
          ? useLaserStore.getState().readMachineSettings()
          : useLaserStore.getState().writeGrblSetting(30, '900');
      await flush();
      const nextEpoch = oldEpoch + 1;
      useLaserStore.setState({
        controllerSessionEpoch: nextEpoch,
        controllerQualification: {
          kind: 'qualifying',
          epoch: nextEpoch,
          phase: 'settings-read',
        },
        controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
        lastWriteError: 'new-session-marker',
      });

      connection.emitLine('error:1');
      await expect(pending).rejects.toThrow();

      expect(useLaserStore.getState()).toMatchObject({
        controllerSessionEpoch: nextEpoch,
        controllerQualification: {
          kind: 'qualifying',
          epoch: nextEpoch,
          phase: 'settings-read',
        },
        controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
        lastWriteError: 'new-session-marker',
      });
    },
  );

  it('does not verify a setting write against rows from a newer controller epoch', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectQualified(connection);
    const oldEpoch = useLaserStore.getState().controllerSessionEpoch;
    const pending = useLaserStore.getState().writeGrblSetting(30, '900');
    await flush();
    expect(writes).toContain('$30=900\n');

    connection.emitLine('ok');
    await flush();
    expect(writes).toContain('$$\n');
    const nextEpoch = oldEpoch + 1;
    useLaserStore.setState({
      controllerSessionEpoch: nextEpoch,
      controllerQualification: {
        kind: 'qualified',
        epoch: nextEpoch,
        settings: 'verified',
      },
      controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
      grblSettingsRows: settingsMapToRows(new Map([[30, '900']])),
      lastWriteError: 'new-session-marker',
    });
    connection.emitLine('ok');

    await expect(pending).rejects.toThrow(
      'Controller session changed while verifying the machine setting.',
    );
    expect(useLaserStore.getState()).toMatchObject({
      controllerSessionEpoch: nextEpoch,
      controllerQualification: {
        kind: 'qualified',
        epoch: nextEpoch,
        settings: 'verified',
      },
      controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
      lastWriteError: 'new-session-marker',
    });
  });

  it('automatically re-reads settings after Abort and allows a fresh job', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectQualified(connection);
    await useLaserStore.getState().startJob('G1 X1 S100\nG1 X2 S100');
    await useLaserStore.getState().stopJob();

    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'qualifying',
      phase: 'reset-cleanup',
    });
    writes.length = 0;
    connection.emitLine('Grbl 1.1f');
    await flush();
    while (useLaserStore.getState().pendingUntrackedAcks > 0) connection.emitLine('ok');
    connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await settleTimers();

    expect(writes.filter((line) => line === '$$\n')).toHaveLength(1);
    connection.emitLine('$30=1000');
    connection.emitLine('$31=0');
    connection.emitLine('$32=1');
    connection.emitLine('ok');
    await flush();
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');

    await expect(useLaserStore.getState().startJob('G1 X9 S100')).resolves.toBeUndefined();
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  });

  it('Forget Controller clears live and recovery state while preserving the project', async () => {
    const writes: string[] = [];
    const connection = makeConnection(writes);
    await connectQualified(connection);
    const project = useStore.getState().project;
    localStorage.setItem('laserforge.job-checkpoint.v1', 'legacy-recovery');
    useLaserStore.setState({
      alarmCode: 3,
      lastError: 20,
      lastWriteError: 'stale error',
      safetyNotice: { kind: 'controller-reboot', message: 'stale warning' },
      airAssistOn: true,
      fireActive: true,
      wcoCache: { x: 1, y: 2, z: 3 },
      ovCache: { feed: 90, rapid: 50, spindle: 80 },
      workOriginActive: true,
      workOriginSource: 'g92',
      log: ['old controller log'],
      frameVerification: {
        boundsSignature: 'old',
        wco: { x: 1, y: 2, z: 3 },
        workOriginActive: true,
      },
    });

    await useLaserStore.getState().forgetDevice?.();

    expect(connection.forget).toHaveBeenCalledOnce();
    expect(useStore.getState().project).toBe(project);
    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'disconnected' },
      statusReport: null,
      controllerSettings: null,
      controllerSettingsObservation: null,
      controllerQualification: { kind: 'disconnected' },
      streamer: null,
      activeRunId: null,
      activeJobMachineKind: null,
      alarmCode: null,
      lastError: null,
      lastWriteError: null,
      safetyNotice: null,
      airAssistOn: false,
      fireActive: false,
      wcoCache: null,
      ovCache: null,
      accessoryCache: null,
      workOriginActive: false,
      workOriginSource: 'none',
      workZZeroEvidence: null,
      frameVerification: null,
      log: [],
      transcript: [],
    });
    expect(localStorage.getItem('laserforge.job-checkpoint.v1')).toBeNull();
    expect(recoveryRepository.getSnapshot()).toMatchObject({
      activeRun: null,
      recoveryCapsule: null,
      lastCompletedReceipt: null,
    });
  });
});

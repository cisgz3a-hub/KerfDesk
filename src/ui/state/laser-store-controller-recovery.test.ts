import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from './laser-store';
import { captureTestLaserStartFenceAck, startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';

async function flush(): Promise<void> {
  for (let index = 0; index < 128; index += 1) await Promise.resolve();
}

function respondToPauseResume(
  data: string,
  controls: { state: string; pauseResumeResponses: boolean },
  emit: (line: string) => void,
  status: () => void,
): void {
  if (!controls.pauseResumeResponses) return;
  if (data === '\x84') {
    controls.state = 'Door:0';
    emit('<Door:0|MPos:0,0,0|FS:0,0|A:>');
  }
  if (data === '~') {
    controls.state = 'Run';
    status();
  }
}

function fixture() {
  const writes: string[] = [];
  const listeners = new Set<(line: string) => void>();
  const controls = {
    state: 'Idle',
    resetBanner: true,
    cleanupAck: true,
    statusResponses: true,
    pauseResumeResponses: false,
  };
  const emit = (line: string) => {
    for (const listener of listeners) listener(line);
  };
  const status = () => emit(`<${controls.state}|MPos:0.000,0.000,0.000|FS:0,0|A:>`);
  const close = vi.fn(async () => undefined);
  const connection: SerialConnection = {
    write: async (data) => {
      const acknowledgeStartFence = captureTestLaserStartFenceAck(data, emit);
      writes.push(data);
      acknowledgeStartFence();
      if (data === '$$\n') {
        emit('$30=1000');
        emit('$31=0');
        emit('$32=1');
        emit('ok');
      }
      if (data === '$I\n') {
        emit('[VER:1.1h.20190830:test]');
        emit('[OPT:VM,15,128]');
        emit('ok');
      }
      if (data === '$G\n') {
        emit('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
        emit('ok');
      }
      if (data === '?' && controls.statusResponses) status();
      respondToPauseResume(data, controls, emit, status);
      if (data === '\x18') {
        setTimeout(() => {
          if (controls.resetBanner) emit('Grbl 1.1f');
          status();
        }, 10);
      }
      if (data === 'M5\n' || (data === 'M9\n' && controls.cleanupAck)) emit('ok');
    },
    onLine: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose: () => () => undefined,
    close,
  };
  const open = vi.fn(async () => connection);
  const requestPort = vi.fn(async () => ({ open }));
  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => true, requestPort },
  };
  const settingsReads = () => writes.filter((line) => line === '$$\n').length;
  return { controls, writes, emit, status, close, open, requestPort, adapter, settingsReads };
}

let currentFixture: ReturnType<typeof fixture> | null = null;

async function connect(): Promise<ReturnType<typeof fixture>> {
  const f = fixture();
  currentFixture = f;
  await useLaserStore.getState().connect(f.adapter);
  f.emit('Grbl 1.1f');
  f.status();
  await flush();
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
  expect(f.settingsReads()).toBe(1);
  return f;
}

function expectQualifying(): void {
  const qualification = useLaserStore.getState().controllerQualification;
  expect(
    qualification.kind,
    qualification.kind === 'failed' ? qualification.message : undefined,
  ).toBe('qualifying');
}

function expectSameConnection(f: ReturnType<typeof fixture>): void {
  expect(useLaserStore.getState().connection.kind).toBe('connected');
  expect(f.open).toHaveBeenCalledOnce();
  expect(f.requestPort).toHaveBeenCalledOnce();
  expect(f.close).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  localStorage.clear();
});

afterEach(async () => {
  if (currentFixture !== null) {
    currentFixture.controls.resetBanner = true;
    currentFixture.controls.cleanupAck = true;
    currentFixture.controls.statusResponses = true;
    currentFixture.controls.state = 'Idle';
  }
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useStore.getState().newProject();
  currentFixture = null;
  vi.restoreAllMocks();
});

describe('controller recovery on the existing connection', () => {
  it('retains controller information and the same port through ordinary Pause and Resume', async () => {
    const f = await connect();
    const information = useLaserStore.getState().controllerSettingsObservation;
    const settings = useLaserStore.getState().controllerSettings;
    const session = useLaserStore.getState().controllerSessionEpoch;
    expect(information).not.toBeNull();
    f.controls.pauseResumeResponses = true;
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    f.controls.state = 'Run';
    f.status();

    await useLaserStore.getState().pauseJob();
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    expect(useLaserStore.getState().controllerSettingsObservation).toBe(information);
    await useLaserStore.getState().resumeJob();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(useLaserStore.getState().controllerSessionEpoch).toBe(session);
    expect(useLaserStore.getState().controllerSettingsObservation).toBe(information);
    expect(useLaserStore.getState().controllerSettings).toBe(settings);
    expect(f.settingsReads()).toBe(1);
    expect(f.writes).not.toContain('\x18');
    expectSameConnection(f);
  });

  it('retains controller information without another read after successful job settlement', async () => {
    const f = await connect();
    const information = useLaserStore.getState().controllerSettingsObservation;
    const session = useLaserStore.getState().controllerSessionEpoch;
    expect(information).not.toBeNull();
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    f.controls.state = 'Run';
    f.status();
    f.emit('ok');
    f.emit('ok');
    await flush();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'post-job-settle',
      phase: 'dwell',
    });
    f.emit('ok');
    await flush();
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'post-job-settle',
      phase: 'awaiting-idle',
    });
    f.controls.state = 'Idle';
    f.status();
    f.status();
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().controllerSessionEpoch).toBe(session);
    expect(useLaserStore.getState().controllerSettingsObservation).toBe(information);
    expect(f.settingsReads()).toBe(1);
    expect(f.writes).not.toContain('\x18');
    expectSameConnection(f);
  });

  it('qualifies the initial connection from a status response when there is no startup greeting', async () => {
    const f = fixture();
    currentFixture = f;
    await useLaserStore.getState().connect(f.adapter);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(f.settingsReads()).toBe(1);
    expect(f.writes).toContain('?');
    expect(f.writes).not.toContain('\x18');
    expectSameConnection(f);
  });

  it('recovers from startup silence when late Idle arrives without reopening the port', async () => {
    const f = fixture();
    currentFixture = f;
    f.controls.statusResponses = false;
    await useLaserStore.getState().connect(f.adapter);

    await vi.advanceTimersByTimeAsync(10_100);

    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(f.settingsReads()).toBe(0);
    expectSameConnection(f);
    f.controls.statusResponses = true;
    f.status();
    await vi.advanceTimersByTimeAsync(250);

    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(f.settingsReads()).toBe(1);
    expect(f.writes).not.toContain('\x18');
    expectSameConnection(f);
  });

  it('keeps the initial Alarm connection open and qualifies when Idle returns', async () => {
    const f = fixture();
    currentFixture = f;
    f.controls.state = 'Alarm';
    await useLaserStore.getState().connect(f.adapter);
    f.emit('Grbl 1.1f');
    f.status();

    await vi.advanceTimersByTimeAsync(30_000);

    expectQualifying();
    expect(f.settingsReads()).toBe(0);
    f.controls.state = 'Idle';
    f.status();
    await vi.advanceTimersByTimeAsync(250);

    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(f.settingsReads()).toBe(1);
    expectSameConnection(f);
  });

  it('recovers after Abort even when the reset greeting is missing', async () => {
    const f = await connect();
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    f.controls.state = 'Run';
    f.emit('ok');
    f.emit('ok');
    await flush();
    f.emit('ok'); // The post-job drain marker has its own real acknowledgement.
    await flush();
    expect(useLaserStore.getState().streamer?.inFlight).toHaveLength(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    f.controls.state = 'Idle';
    f.controls.resetBanner = false;

    await useLaserStore.getState().stopJob();
    expect(useLaserStore.getState().controllerSettingsObservation).toBeNull();
    await vi.advanceTimersByTimeAsync(400);
    expect(f.settingsReads()).toBe(1);
    await vi.advanceTimersByTimeAsync(350);

    expect(f.writes).toContain('M5\n');
    expect(f.writes).toContain('M9\n');
    expect(f.settingsReads()).toBe(2);
    const state = useLaserStore.getState();
    expect(state.controllerQualification).toMatchObject({
      kind: 'qualified',
      settings: 'verified',
    });
    expect(state.controllerSettingsObservation?.sessionEpoch).toBe(state.controllerSessionEpoch);
    expect(state.pendingUntrackedAcks).toBe(0);
    expect(state.frameVerification).toBeNull();
    expectSameConnection(f);
  });

  it.each(['Alarm', 'Sleep'])(
    'waits in %s after Abort and refreshes automatically after fresh Idle',
    async (controllerState) => {
      const f = await connect();
      await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
      f.controls.state = controllerState;

      await useLaserStore.getState().stopJob();
      await vi.advanceTimersByTimeAsync(30_000);

      expectQualifying();
      expect(f.settingsReads()).toBe(1);
      f.controls.state = 'Idle';
      f.status();
      await vi.advanceTimersByTimeAsync(250);

      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
      expect(f.settingsReads()).toBe(2);
      expectSameConnection(f);
    },
  );

  it.each(['Alarm', 'Sleep'])(
    'detects silence after a retained %s report and refreshes after a late Idle response',
    async (controllerState) => {
      const f = await connect();
      await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
      f.controls.state = controllerState;
      await useLaserStore.getState().stopJob();
      await vi.advanceTimersByTimeAsync(250);
      expectQualifying();
      expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      f.controls.statusResponses = false;
      const lastStatusSequence = useLaserStore.getState().statusSequence;

      await vi.advanceTimersByTimeAsync(8_000);

      expect(useLaserStore.getState().statusSequence).toBe(lastStatusSequence);
      expect(useLaserStore.getState().statusReport?.state).toBe(controllerState);
      expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
      expect(f.settingsReads()).toBe(1);
      expectSameConnection(f);
      f.controls.state = 'Idle';
      f.controls.statusResponses = true;
      f.status();
      await vi.advanceTimersByTimeAsync(250);

      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
      expect(f.settingsReads()).toBe(2);
      expectSameConnection(f);
    },
  );

  it('retains a lost cleanup acknowledgement and resumes only after its real reply arrives', async () => {
    const f = await connect();
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    f.controls.cleanupAck = false;
    f.emit('error:20');
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expectQualifying();
    expect(f.settingsReads()).toBe(1);
    await expect(useLaserStore.getState().retryControllerQualification()).rejects.toThrow(
      'previous controller write and acknowledgement',
    );
    f.emit('ok');
    await vi.advanceTimersByTimeAsync(250);

    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(f.settingsReads()).toBe(2);
    expectSameConnection(f);
  });
});

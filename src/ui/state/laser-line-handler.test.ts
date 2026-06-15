import { describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  idleCollector,
  onAck,
  startCollecting,
  step,
  type SettingsCollectorState,
} from '../../core/controllers/grbl';
import { handleLine, type GetFn, type SetFn } from './laser-line-handler';
import type { LaserState } from './laser-store';

function makeLaserState(): LaserState {
  return {
    connection: { kind: 'connected' },
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
    connect: async () => undefined,
    disconnect: async () => undefined,
    home: async () => undefined,
    autofocus: async () => ({ kind: 'preflight-failed', reason: 'unused' }),
    unlockAlarm: async () => undefined,
    jog: async () => undefined,
    cancelJog: async () => undefined,
    frame: async () => undefined,
    startJob: async () => undefined,
    pauseJob: async () => undefined,
    resumeJob: async () => undefined,
    stopJob: async () => undefined,
    clearSafetyNotice: () => undefined,
    applyDetectedSettings: () => undefined,
    dismissDetectedSettings: () => undefined,
    setOriginHere: async () => undefined,
    resetOrigin: async () => undefined,
    configureGrblLaserSetup: async () => undefined,
    sendConsoleCommand: async () => undefined,
    clearTranscript: () => undefined,
  };
}

function makeHarness(): {
  readonly refs: { settingsCollector: SettingsCollectorState; onLineArrived: null };
  readonly set: SetFn;
  readonly get: GetFn;
} {
  let state = makeLaserState();
  const set: SetFn = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch } as LaserState;
  };
  return {
    refs: { settingsCollector: startCollecting(), onLineArrived: null },
    set,
    get: () => state,
  };
}

describe('handleLine detected controller settings', () => {
  it('publishes detected settings both for the banner and for live Start readiness', () => {
    const { refs, set, get } = makeHarness();

    for (const line of ['$22=1', '$30=255', '$31=0', '$32=1', 'ok']) {
      handleLine(set, get, refs, async () => undefined, line);
    }

    expect(refs.settingsCollector).toEqual(idleCollector());
    expect(get().detectedSettings).toMatchObject({
      maxPowerS: 255,
      minPowerS: 0,
      laserModeEnabled: true,
    });
    expect(get().controllerSettings).toMatchObject({
      homingEnabled: true,
      maxPowerS: 255,
      minPowerS: 0,
      laserModeEnabled: true,
    });
  });
});

describe('handleLine streamer writes', () => {
  it('keeps a fully acked job busy until a later Idle status confirms physical motion is done', () => {
    const { refs, set, get } = makeHarness();
    let streamer = step(createStreamer('G21\nG90\nG1 X10 F600\nM5\n')).state;
    for (let i = 0; i < 4; i += 1) streamer = onAck(streamer, 'ok').state;
    set({ streamer });
    expect(get().streamer?.status).toBe('done');

    handleLine(set, get, refs, async () => undefined, '<Run|MPos:1.000,0.000,0.000|FS:600,0>');

    expect(get().streamer?.status).toBe('done');

    handleLine(set, get, refs, async () => undefined, '<Idle|MPos:10.000,0.000,0.000|FS:0,0>');

    expect(get().streamer).toBeNull();
  });

  it('marks the streamer disconnected if an ack-triggered follow-up write fails', async () => {
    const { refs, set, get } = makeHarness();
    const firstStep = step(
      createStreamer('G1 X1234567890\nG1 X1234567891\nG1 X1234567892\n', {
        rxBufferBytes: 30,
      }),
    );
    set({ streamer: firstStep.state });
    const safeWrite = vi.fn(async () => {
      throw new Error('port lost');
    });

    handleLine(set, get, refs, safeWrite, 'ok');
    await Promise.resolve();

    expect(safeWrite).toHaveBeenCalledWith('G1 X1234567892\n');
    expect(get().streamer?.status).toBe('disconnected');
    expect(get().streamer?.completed).toBe(1);
    expect(get().streamer?.inFlight.map((item) => item.line)).toEqual(['G1 X1234567891\n']);
    expect(get().streamer?.queued).toEqual([]);
    // P0-3: a follow-up write failure must also raise the operator-facing safety
    // banner - the machine may still be moving from buffered commands.
    expect(get().safetyNotice).toEqual({
      kind: 'disconnect-during-job',
      message: expect.stringContaining('still be moving'),
    });
  });
});

describe('handleLine controller error (P0-1)', () => {
  it('stops the stream and raises a safety notice when GRBL rejects a line mid-job', () => {
    const { refs, set, get } = makeHarness();
    // rxBuffer 30 leaves the third line queued, so before the fix the error ack
    // would have written the next queued bytes. Now it must write nothing.
    const firstStep = step(
      createStreamer('G1 X1234567890\nG1 X1234567891\nG1 X1234567892\n', {
        rxBufferBytes: 30,
      }),
    );
    set({ streamer: firstStep.state });
    expect(get().streamer?.queued.length).toBeGreaterThan(0);
    const safeWrite = vi.fn(async () => undefined);

    handleLine(set, get, refs, safeWrite, 'error:7');

    // Terminal: no further bytes go to the controller.
    expect(get().streamer?.status).toBe('errored');
    expect(safeWrite).not.toHaveBeenCalled();
    // The code is recorded and the operator is told to check the machine.
    expect(get().lastError).toBe(7);
    expect(get().safetyNotice).toEqual({
      kind: 'controller-error',
      code: 7,
      message: expect.stringContaining('error:7'),
    });
  });

  it('uses non-job wording when GRBL rejects a frame jog command', () => {
    const { refs, set, get } = makeHarness();
    set({
      motionOperation: {
        kind: 'frame',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [],
      },
    });

    handleLine(set, get, refs, async () => undefined, 'error:8');

    expect(get().lastError).toBe(8);
    expect(get().safetyNotice).toEqual({
      kind: 'controller-error',
      code: 8,
      message: expect.stringContaining('frame command'),
    });
    expect(get().safetyNotice?.message).not.toContain('during the job');
  });
});

describe('handleLine status-only Alarm recovery state', () => {
  it('clears motion and custom-origin state when GRBL reports Alarm without ALARM:N', () => {
    const { refs, set, get } = makeHarness();
    set({
      alarmCode: null,
      wcoCache: { x: 25, y: 40, z: 0 },
      workOriginActive: true,
      motionOperation: {
        kind: 'frame',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [],
      },
    });

    handleLine(set, get, refs, async () => undefined, '<Alarm|MPos:0.000,0.000,12.089|FS:0,0>');

    expect(get().statusReport?.state).toBe('Alarm');
    expect(get().alarmCode).toBeNull();
    expect(get().motionOperation).toBeNull();
    expect(get().wcoCache).toBeNull();
    expect(get().workOriginActive).toBe(false);
  });
});

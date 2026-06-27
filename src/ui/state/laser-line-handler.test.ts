import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CMD_COOLANT_OFF,
  RT_SOFT_RESET,
  createStreamer,
  idleCollector,
  startCollecting,
  step,
} from '../../core/controllers/grbl';
import { handleLine, type GetFn, type HandlerRefs, type SetFn } from './laser-line-handler';
import type { LaserState } from './laser-store';
import type { FrameVerification } from './frame-verification';

afterEach(() => {
  vi.useRealTimers();
});

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
    controllerOperation: null,
    streamer: null,
    homingState: 'unknown',
    log: [],
    transcript: [],
    detectedSettings: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    wcoCache: null,
    workOriginActive: false,
    frameVerification: null,
    connect: async () => undefined,
    disconnect: async () => undefined,
    home: async () => undefined,
    autofocus: async () => ({ kind: 'preflight-failed', reason: 'unused' }),
    unlockAlarm: async () => undefined,
    wakeController: async () => undefined,
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
    releaseMotors: async () => undefined,
    markFrameVerified: () => undefined,
    configureGrblLaserSetup: async () => undefined,
    readMachineSettings: async () => undefined,
    writeGrblSetting: async () => undefined,
    sendConsoleCommand: async () => undefined,
    clearTranscript: () => undefined,
  };
}

function makeHarness(): {
  readonly refs: HandlerRefs;
  readonly set: SetFn;
  readonly get: GetFn;
} {
  let state = makeLaserState();
  const set: SetFn = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch } as LaserState;
  };
  return {
    refs: {
      settingsCollector: startCollecting(),
      onLineArrived: null,
      controllerCommand: null,
      controllerIdleWait: null,
    },
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
    expect(get().grblSettingsRows.map((row) => row.code)).toEqual(['$22', '$30', '$31', '$32']);
  });

  it('keeps review-only controller settings pending for the Machine Setup review banner', () => {
    const { refs, set, get } = makeHarness();

    for (const line of ['$20=1', '$21=0', '$22=1', '$23=3', 'ok']) {
      handleLine(set, get, refs, async () => undefined, line);
    }

    expect(refs.settingsCollector).toEqual(idleCollector());
    expect(get().detectedSettings).toEqual({});
    expect(get().controllerSettings).toMatchObject({
      softLimitsEnabled: true,
      hardLimitsEnabled: false,
      homingEnabled: true,
      homingDirectionMask: 3,
    });
    expect(get().grblSettingsRows.map((row) => row.code)).toEqual(['$20', '$21', '$22', '$23']);
  });
});

describe('handleLine streamer writes', () => {
  it('keeps a fully acked job busy until the post-job settle marker and stable Idle finish', async () => {
    const { refs, set, get } = makeHarness();
    const safeWrite = vi.fn(
      async (_payload: string, _action?: unknown, _source?: unknown): Promise<void> => undefined,
    );
    set({ streamer: step(createStreamer('G21\nG90\nG1 X10 F600\nM5\n')).state });
    for (let i = 0; i < 4; i += 1) handleLine(set, get, refs, safeWrite, 'ok');
    await Promise.resolve();

    expect(get().streamer?.status).toBe('done');
    expect(get().controllerOperation).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });
    expect(safeWrite).toHaveBeenCalledWith('G4 P0.01\n', 'console', 'system');

    handleLine(set, get, refs, safeWrite, '<Run|MPos:1.000,0.000,0.000|FS:600,0>');
    expect(get().streamer?.status).toBe('done');

    handleLine(set, get, refs, safeWrite, '<Idle|MPos:10.000,0.000,0.000|FS:0,0>');

    expect(get().streamer?.status).toBe('done');
    handleLine(set, get, refs, safeWrite, 'ok');
    await Promise.resolve();
    handleLine(set, get, refs, safeWrite, '<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    expect(get().streamer?.status).toBe('done');
    handleLine(set, get, refs, safeWrite, '<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await Promise.resolve();
    expect(get().streamer).toBeNull();
  });

  it('keeps post-job settle alive while fresh Run status proves buffered motion is still finishing', async () => {
    vi.useFakeTimers();
    const { refs, set, get } = makeHarness();
    const safeWrite = vi.fn(
      async (_payload: string, _action?: unknown, _source?: unknown): Promise<void> => undefined,
    );
    set({ streamer: step(createStreamer('G21\nG90\nG1 X10 F600\nM5\n')).state });
    for (let i = 0; i < 4; i += 1) handleLine(set, get, refs, safeWrite, 'ok');
    await Promise.resolve();

    expect(get().streamer?.status).toBe('done');
    expect(get().controllerOperation).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });

    await vi.advanceTimersByTimeAsync(4_000);
    handleLine(set, get, refs, safeWrite, '<Run|MPos:5.000,0.000,0.000|FS:600,0>');
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();

    expect(get().controllerOperation).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });
    expect(get().lastWriteError).toBeNull();
    expect(get().streamer?.status).toBe('done');

    handleLine(set, get, refs, safeWrite, 'ok');
    await Promise.resolve();
    handleLine(set, get, refs, safeWrite, '<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    handleLine(set, get, refs, safeWrite, '<Idle|MPos:10.000,0.000,0.000|FS:0,0>');
    await Promise.resolve();

    expect(get().controllerOperation).toBeNull();
    expect(get().streamer).toBeNull();
  });

  it('releases the job lock once an errored stream settles to Idle, keeping the error notice', () => {
    const { refs, set, get } = makeHarness();
    set({ streamer: step(createStreamer('G1 X1\nG1 X2\nG1 X3\n')).state });
    // GRBL rejects a line mid-job: terminal 'errored' + a controller-error notice.
    handleLine(set, get, refs, async () => undefined, 'error:7');
    expect(get().streamer?.status).toBe('errored');
    expect(get().safetyNotice).not.toBeNull();

    // Still settling — the lock holds until motion stops.
    handleLine(set, get, refs, async () => undefined, '<Run|MPos:1.000,0.000,0.000|FS:600,0>');
    expect(get().streamer?.status).toBe('errored');

    // Idle means motion stopped: the dead job lock releases so the controller
    // is usable again, while the operator still sees the error notice.
    handleLine(set, get, refs, async () => undefined, '<Idle|MPos:1.000,0.000,0.000|FS:0,0>');
    expect(get().streamer).toBeNull();
    expect(get().safetyNotice).not.toBeNull();
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
  it('soft-resets the controller and raises a safety notice when GRBL rejects a line mid-job', async () => {
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
    const safeWrite = vi.fn(
      async (_payload: string, _action?: unknown, _source?: unknown): Promise<void> => undefined,
    );

    handleLine(set, get, refs, safeWrite, 'error:7');
    await Promise.resolve();
    await Promise.resolve();

    // Terminal: no further job bytes go to the controller, but the realtime
    // soft-reset is still sent to drain any already-buffered laser-on motion.
    expect(get().streamer?.status).toBe('errored');
    expect(safeWrite).toHaveBeenNthCalledWith(1, RT_SOFT_RESET, 'stop', 'system');
    expect(safeWrite).toHaveBeenNthCalledWith(2, `${CMD_COOLANT_OFF}\n`, 'stop', 'system');
    expect(safeWrite.mock.calls.some(([payload]) => payload.startsWith('G1 '))).toBe(false);
    // The code is recorded and the operator is told to check the machine.
    expect(get().lastError).toBe(7);
    expect(get().safetyNotice).toEqual({
      kind: 'controller-error',
      code: 7,
      rejectedLine: 'G1 X1234567890',
      message: expect.stringContaining('error:7'),
    });
  });

  it('includes the rejected in-flight G-code line in the controller-error notice', () => {
    const { refs, set, get } = makeHarness();
    set({ streamer: step(createStreamer('G1 X10 F600 S100\nG1 X20\n')).state });

    handleLine(set, get, refs, async () => undefined, 'error:7');

    expect(get().safetyNotice).toEqual({
      kind: 'controller-error',
      code: 7,
      rejectedLine: 'G1 X10 F600 S100',
      message: expect.stringContaining('Rejected line: G1 X10 F600 S100'),
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

  it('stops the stream for unrecognized error responses without treating them as GRBL codes', () => {
    const { refs, set, get } = makeHarness();
    set({ streamer: step(createStreamer('G1 X1\nG1 X2\n')).state });

    handleLine(set, get, refs, async () => undefined, 'error:7002009');

    expect(get().streamer?.status).toBe('errored');
    expect(get().lastError).toBeNull();
    expect(get().safetyNotice).toEqual({
      kind: 'controller-error',
      code: null,
      raw: 'error:7002009',
      rejectedLine: 'G1 X1',
      message: expect.stringContaining('unrecognized controller error response: error:7002009'),
    });
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

describe('handleLine Sleep recovery state', () => {
  it('clears stale alarm, motion, and custom-origin state when GRBL reports Sleep', () => {
    const { refs, set, get } = makeHarness();
    set({
      alarmCode: 9,
      wcoCache: { x: 25, y: 40, z: 0 },
      workOriginActive: true,
      frameVerification: {
        boundsSignature: '0,0,50,50',
        wco: { x: 25, y: 40, z: 0 },
        workOriginActive: true,
      },
      motionOperation: {
        kind: 'frame',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [],
      },
    });

    handleLine(set, get, refs, async () => undefined, '<Sleep|MPos:25.000,40.000,0.000|FS:0,0>');

    expect(get().statusReport?.state).toBe('Sleep');
    expect(get().alarmCode).toBeNull();
    expect(get().motionOperation).toBeNull();
    expect(get().wcoCache).toBeNull();
    expect(get().workOriginActive).toBe(false);
    expect(get().frameVerification).toBeNull();
    expect(get().homingState).toBe('unknown');
  });
});

describe('handleLine hard-limit during Verified Frame (ADR-053 P3)', () => {
  const verification: FrameVerification = {
    boundsSignature: '0,0,50,50',
    wco: { x: 100, y: 80, z: 0 },
    workOriginActive: true,
  };

  function frameInFlightState(set: SetFn): void {
    set({
      frameVerification: verification,
      workOriginActive: true,
      wcoCache: { x: 100, y: 80, z: 0 },
      statusReport: {
        state: 'Run',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        feed: 0,
        spindle: 0,
        wco: null,
        pins: { limitX: true, limitY: false, limitZ: false, probe: false, door: false },
      },
      motionOperation: {
        kind: 'frame',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [],
      },
    });
  }

  it('raises a frame-limit notice naming the axis and clears the verification', () => {
    const { refs, set, get } = makeHarness();
    frameInFlightState(set);

    handleLine(set, get, refs, async () => undefined, 'ALARM:1');

    expect(get().alarmCode).toBe(1);
    expect(get().safetyNotice?.kind).toBe('frame-limit');
    expect(get().safetyNotice?.message).toContain('X limit');
    expect(get().frameVerification).toBeNull();
    expect(get().motionOperation).toBeNull();
  });

  it('does not raise a frame-limit notice for a hard-limit alarm outside a frame', () => {
    const { refs, set, get } = makeHarness();
    frameInFlightState(set);
    set({ motionOperation: null });

    handleLine(set, get, refs, async () => undefined, 'ALARM:1');

    expect(get().alarmCode).toBe(1);
    expect(get().safetyNotice).toBeNull();
    expect(get().frameVerification).toBeNull();
  });

  it('does not treat a non-limit alarm (ALARM:2) during a frame as a limit hit', () => {
    const { refs, set, get } = makeHarness();
    frameInFlightState(set);

    handleLine(set, get, refs, async () => undefined, 'ALARM:2');

    expect(get().alarmCode).toBe(2);
    expect(get().safetyNotice).toBeNull();
    expect(get().frameVerification).toBeNull();
  });
});

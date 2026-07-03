import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CMD_COOLANT_OFF,
  RT_SOFT_RESET,
  cancel,
  createStreamer,
  idleCollector,
  onAck,
  pause,
  startCollecting,
  step,
} from '../../core/controllers/grbl';
import { grblDriver } from '../../core/controllers';
import { handleLine, type GetFn, type HandlerRefs, type SetFn } from './laser-line-handler';
import type { LaserState } from './laser-store';

afterEach(() => {
  vi.useRealTimers();
});

function makeLaserState(): LaserState {
  return {
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'connected' },
    statusReport: null,
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    autofocusBusy: false,
    probeBusy: false,
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
    ovCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
    frameVerification: null,
    connect: async () => undefined,
    disconnect: async () => undefined,
    home: async () => undefined,
    autofocus: async () => ({ kind: 'preflight-failed', reason: 'unused' }),
    probe: async () => ({ kind: 'preflight-failed', reason: 'unused' }),
    sendRealtimeOverride: async () => undefined,
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
    zeroZHere: async () => undefined,
    resetOrigin: async () => undefined,
    setPersistentOriginHere: async () => undefined,
    clearPersistentOrigin: async () => undefined,
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
      driver: grblDriver,
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
  // Mid-job refills are the job stream continuing — transcribed as anything
  // else, the console's "hide job stream" filter stops hiding them and the
  // panel floods with raw G-code during every job.
  it('tags ack-driven refill writes with the job transcript source', () => {
    const { refs, set, get } = makeHarness();
    const safeWrite = vi.fn(
      async (_payload: string, _action?: unknown, _source?: unknown): Promise<void> => undefined,
    );
    // Eight 29-byte lines: the 120-byte first window holds four, so each ack
    // triggers a refill write for the next queued line.
    const longLine = 'G1 X99.000 Y99.000 F600 S255';
    const gcode = Array.from({ length: 8 }, () => longLine).join('\n');
    set({ streamer: step(createStreamer(gcode)).state });

    handleLine(set, get, refs, safeWrite, 'ok');

    expect(safeWrite).toHaveBeenCalledWith(`${longLine}\n`, undefined, 'job');
  });

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

  // markErrored, not disconnect: 'disconnected' falls outside isActiveJob,
  // which unmounts the Stop button and drops the soft-reset stop path while
  // GRBL may still be executing buffered lines on a live port (the same R-H2
  // rationale runResumeJob documents). A genuine port loss follows up via
  // onClose, which owns the disconnect wording.
  it('marks the streamer errored (Stop stays mounted) if an ack-triggered follow-up write fails', async () => {
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

    expect(safeWrite).toHaveBeenCalledWith('G1 X1234567892\n', undefined, 'job');
    expect(get().streamer?.status).toBe('errored');
    expect(get().streamer?.completed).toBe(1);
    // The undelivered refill line stays in the in-flight accounting: the
    // stream is terminal (nothing more is ever sent), acks for the lines that
    // WERE delivered still absorb correctly, and the never-acked tail is
    // harmless — while a snapshot rollback would clobber acks that landed
    // between dispatch and rejection.
    expect(get().streamer?.inFlight.map((item) => item.line)).toEqual([
      'G1 X1234567891\n',
      'G1 X1234567892\n',
    ]);
    expect(get().streamer?.queued).toEqual([]);
    // P0-3: a follow-up write failure must also raise the operator-facing safety
    // banner - the machine may still be moving from buffered commands.
    expect(get().safetyNotice).toEqual({
      kind: 'write-failed',
      action: 'stream',
      message: expect.stringContaining('Stop'),
    });
  });
});

describe('handleLine alarm terminates paused streams', () => {
  // GRBL keeps acking held lines during a feed hold, so a paused stream
  // routinely has an empty in-flight tail. An alarm then must still cancel
  // the stream — otherwise Resume stays mounted and streams the queued job
  // into a locked controller.
  function drainedPausedStreamer(): ReturnType<typeof pause> {
    const first = step(
      createStreamer('G1 X1234567890\nG1 X1234567891\nG1 X1234567892\n', { rxBufferBytes: 30 }),
    );
    let state = pause(first.state);
    state = onAck(state, 'ok').state;
    state = onAck(state, 'ok').state;
    expect(state.inFlight).toEqual([]);
    expect(state.status).toBe('paused');
    return state;
  }

  it('cancels a drained paused stream on an ALARM:N line', () => {
    const { refs, set, get } = makeHarness();
    set({ streamer: drainedPausedStreamer() });

    handleLine(set, get, refs, async () => undefined, 'ALARM:1');

    expect(get().streamer?.status).toBe('cancelled');
    expect(get().streamer?.queued).toEqual([]);
  });

  it('cancels a drained paused stream on a status-only Alarm report', () => {
    const { refs, set, get } = makeHarness();
    set({ streamer: drainedPausedStreamer() });

    handleLine(set, get, refs, async () => undefined, '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');

    expect(get().streamer?.status).toBe('cancelled');
    expect(get().streamer?.queued).toEqual([]);
  });
});

describe('handleLine controller error notices after stop', () => {
  // Stop sends realtime 0x18 then a queued beam-off line; GRBL is locked
  // after the reset and bounces that line with error:9. That echo is part of
  // the shutdown the user asked for — painting it as "the laser may have
  // fired out of place" turns every routine Stop into a false alarm.
  it('raises no safety notice for an error acking an already-cancelled stream', () => {
    const { refs, set, get } = makeHarness();
    const streaming = step(createStreamer('G1 X10 F600\nM5\n')).state;
    set({ streamer: cancel(streaming) });

    handleLine(set, get, refs, async () => undefined, 'error:9');

    expect(get().safetyNotice).toBeNull();
    expect(get().lastError).toBe(9);
    expect(get().streamer?.status).toBe('cancelled');
  });

  it('keeps the root-cause notice when the auto-stop beam-off line bounces afterwards', () => {
    const { refs, set, get } = makeHarness();
    set({
      streamer: step(
        createStreamer('G1 X1234567890\nG1 X1234567891\nG1 X1234567892\n', {
          rxBufferBytes: 30,
        }),
      ).state,
    });

    // The real stream error — this is the notice the operator must keep.
    handleLine(set, get, refs, async () => undefined, 'error:7');
    expect(get().streamer?.status).toBe('errored');
    expect(get().safetyNotice).toMatchObject({ kind: 'controller-error', code: 7 });

    // The auto-stop's queued M9 bouncing off the post-reset lock.
    handleLine(set, get, refs, async () => undefined, 'error:9');

    expect(get().safetyNotice).toMatchObject({ kind: 'controller-error', code: 7 });
    expect(get().lastError).toBe(9);
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

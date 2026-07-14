import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CMD_COOLANT_OFF,
  RT_SOFT_RESET,
  cancel,
  createStreamer,
  queuedLineCount,
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
    airAssistOn: false,
    fireActive: false,
    autofocusBusy: false,
    probeBusy: false,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    activeJobMachineKind: null,
    pendingUntrackedAcks: 0,
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
    workZZeroEvidence: null,
    workZReferenceEpoch: 0,
    toolChangeIdleSeen: false,
    toolChangeLabels: [],
    toolChangeToolIds: [],
    pendingToolLabel: null,
    pendingToolId: null,
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
    jogToMachinePosition: async () => undefined,
    setAirAssistEnabled: async () => undefined,
    setFireActive: async () => undefined,
    cancelJog: async () => undefined,
    frame: async () => undefined,
    startJob: async () => undefined,
    pauseJob: async () => undefined,
    resumeJob: async () => undefined,
    continueToolChange: async () => undefined,
    stopJob: async () => undefined,
    clearSafetyNotice: () => undefined,
    pushSystemNotice: () => undefined,
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
    confirmProbePlateRemoved: () => undefined,
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
      pendingResetCleanup: null,
    },
    set,
    get: () => state,
  };
}

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
    const activeStream = get().streamer;
    expect(activeStream === null ? 0 : queuedLineCount(activeStream)).toBeGreaterThan(0);
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
    // The reset wiped the in-flight accounting (audit F1)...
    expect(get().streamer?.inFlight).toEqual([]);
    // ...and the M9 beam-off cleanup is deferred until the boot banner
    // arrives (audit F2), so it is NOT written yet.
    expect(safeWrite.mock.calls.some(([payload]) => payload === `${CMD_COOLANT_OFF}\n`)).toBe(
      false,
    );
    handleLine(set, get, refs, safeWrite, 'Grbl 1.1f');
    await Promise.resolve();
    await Promise.resolve();
    expect(safeWrite.mock.calls.some(([payload]) => payload === `${CMD_COOLANT_OFF}\n`)).toBe(true);
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
      pendingUntrackedAcks: 1,
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

import { describe, expect, it, vi } from 'vitest';
import { startCollecting } from '../../core/controllers/grbl';
import { grblDriver } from '../../core/controllers';
import type { FrameVerification } from './frame-verification';
import { handleLine, type GetFn, type HandlerRefs, type SetFn } from './laser-line-handler';
import type { LaserState } from './laser-store';

function makeLaserState(): LaserState {
  return {
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'connected' },
    statusReport: null,
    controllerSessionEpoch: 0,
    statusSequence: 0,
    statusObservation: null,
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
    activeRunId: null,
    activeJobMachineKind: null,
    pendingUntrackedAcks: 0,
    homingState: 'unknown',
    homingProof: null,
    log: [],
    transcript: [],
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    controllerQualification: { kind: 'qualified', epoch: 0, settings: 'verified' },
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    wcoCache: null,
    activeWcs: null,
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
    framedRun: null,
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
    recoverWorkZFromController: async () => undefined,
    resetOrigin: async () => undefined,
    setPersistentOriginHere: async () => undefined,
    clearPersistentOrigin: async () => undefined,
    releaseMotors: async () => undefined,
    configureGrblLaserSetup: async () => undefined,
    readMachineSettings: async () => undefined,
    retryControllerQualification: async () => undefined,
    writeGrblSetting: async () => undefined,
    sendConsoleCommand: async () => undefined,
    selectPrimaryWcsForFrame: async () => undefined,
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
      settingsCollectorSessionEpoch: 0,
      onLineArrived: null,
      controllerCommand: null,
      controllerIdleWait: null,
      pendingResetCleanup: null,
    },
    set,
    get: () => state,
  };
}

describe('frame proof records at trace completion (ADR-228 amendment)', () => {
  const armed: FrameVerification = {
    boundsSignature: '0,0,25,25',
    wco: null,
    workOriginActive: false,
  };

  function armedFrameOp(pendingLines: ReadonlyArray<string>): LaserState['motionOperation'] {
    return {
      operationId: 1,
      kind: 'frame',
      sawControllerBusy: false,
      idleStatusReports: 0,
      dispatchComplete: true,
      pendingLines,
      verification: armed,
    };
  }

  it('promotes the armed verification only when the trace settles with an empty queue', () => {
    const { refs, set, get } = makeHarness();
    set({ motionOperation: armedFrameOp([]) });

    handleLine(set, get, refs, async () => undefined, '<Run|MPos:5.000,5.000,0.000|FS:1000,0>');
    expect(get().frameVerification).toBeNull();

    handleLine(set, get, refs, async () => undefined, '<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(get().motionOperation).toBeNull();
    expect(get().frameVerification).toEqual(armed);
  });

  it('keeps the proof unrecorded while queued perimeter legs remain', async () => {
    const { refs, set, get } = makeHarness();
    set({ motionOperation: armedFrameOp(['$J=G90 G21 X10.000 Y0.000 F1000\n']) });
    const safeWrite = vi.fn(async () => undefined);

    handleLine(set, get, refs, safeWrite, '<Run|MPos:5.000,5.000,0.000|FS:1000,0>');
    handleLine(set, get, refs, safeWrite, '<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await Promise.resolve();

    expect(get().frameVerification).toBeNull();
    // The re-armed operation for the next leg still carries the payload.
    expect(get().motionOperation).toMatchObject({ kind: 'frame', verification: armed });
  });

  it('never promotes an armed verification after a mid-trace alarm', () => {
    const { refs, set, get } = makeHarness();
    set({ motionOperation: armedFrameOp([]) });

    handleLine(set, get, refs, async () => undefined, 'ALARM:1');

    expect(get().motionOperation).toBeNull();
    expect(get().frameVerification).toBeNull();
  });
});

describe('handleLine queued Frame writes', () => {
  it('clears frame verification when a queued frame leg fails to write', async () => {
    const { refs, set, get } = makeHarness();
    const verification: FrameVerification = {
      boundsSignature: '0,0,10,10',
      wco: { x: 0, y: 0, z: 0 },
      workOriginActive: false,
    };
    set({
      frameVerification: verification,
      motionOperation: {
        operationId: 1,
        kind: 'frame',
        sawControllerBusy: true,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: ['$J=G90 G21 X10.000 Y0.000 F1000\n'],
      },
    });
    const safeWrite = vi.fn(async () => {
      throw new Error('port lost');
    });

    handleLine(set, get, refs, safeWrite, '<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await Promise.resolve();
    await Promise.resolve();

    expect(safeWrite).toHaveBeenCalledWith('$J=G90 G21 X10.000 Y0.000 F1000\n', 'frame');
    expect(get().motionOperation).toMatchObject({
      kind: 'frame',
      cancelRequested: true,
    });
    expect(get().frameVerification).toBeNull();
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
        operationId: 2,
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

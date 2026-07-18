// handleLine Ov override caching (ADR-103 G3): the `Ov:` field is reported
// intermittently, so the cache must persist across Ov-less frames and clear
// on Alarm exactly like wcoCache. Split from laser-line-handler.test.ts
// (file line cap); the state builder mirrors that file's.

import { describe, expect, it } from 'vitest';
import { startCollecting } from '../../core/controllers/grbl';
import { grblDriver } from '../../core/controllers';
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
    accessoryCache: null,
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

describe('handleLine Ov override caching (ADR-103 G3)', () => {
  it('caches Ov values across frames that omit the field', () => {
    const { refs, set, get } = makeHarness();

    handleLine(
      set,
      get,
      refs,
      async () => undefined,
      '<Run|MPos:0.000,0.000,0.000|FS:1000,8000|Ov:120,50,90>',
    );
    expect(get().ovCache).toEqual({ feed: 120, rapid: 50, spindle: 90 });

    // Next frame has no Ov field — the cache must NOT flicker back to null.
    handleLine(set, get, refs, async () => undefined, '<Run|MPos:1.000,0.000,0.000|FS:1000,8000>');
    expect(get().ovCache).toEqual({ feed: 120, rapid: 50, spindle: 90 });
  });

  it('clears the cache when the controller enters Alarm', () => {
    const { refs, set, get } = makeHarness();
    handleLine(
      set,
      get,
      refs,
      async () => undefined,
      '<Run|MPos:0.000,0.000,0.000|FS:0,0|Ov:110,100,100>',
    );
    expect(get().ovCache).not.toBeNull();
    handleLine(set, get, refs, async () => undefined, '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(get().ovCache).toBeNull();
  });

  it('latches secondary-spindle presence across later sparse grblHAL reports', () => {
    const { refs, set, get } = makeHarness();
    handleLine(
      set,
      get,
      refs,
      async () => undefined,
      '<Idle|MPos:0.000,0.000,0.000|FS:0,0|SP1:12000,,S,100|Ov:100,100,100>',
    );
    expect(get().accessoryCache?.secondarySpindlePresent).toBe(true);

    handleLine(
      set,
      get,
      refs,
      async () => undefined,
      '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>',
    );
    expect(get().accessoryCache?.secondarySpindlePresent).toBe(true);
  });

  it('latches grblHAL exceptional A flags until an explicit A report clears them', () => {
    const { refs, set, get } = makeHarness();
    handleLine(
      set,
      get,
      refs,
      async () => undefined,
      '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:ET>',
    );
    expect(get().accessoryCache).toMatchObject({
      spindleEncoderFault: true,
      toolChangePending: true,
    });

    handleLine(
      set,
      get,
      refs,
      async () => undefined,
      '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>',
    );
    expect(get().accessoryCache).toMatchObject({
      spindleEncoderFault: true,
      toolChangePending: true,
    });

    handleLine(
      set,
      get,
      refs,
      async () => undefined,
      '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:>',
    );
    expect(get().accessoryCache?.spindleEncoderFault).toBeUndefined();
    expect(get().accessoryCache?.toolChangePending).toBeUndefined();
  });
});

describe('handleLine A accessory caching (ADR-179)', () => {
  it('preserves an active observation across sparse frames, then clears it on Ov without A', () => {
    const { refs, set, get } = makeHarness();

    handleLine(
      set,
      get,
      refs,
      async () => undefined,
      '<Idle|MPos:0.000,0.000,0.000|FS:0,8000|Ov:100,100,100|A:SF>',
    );
    expect(get().accessoryCache).toEqual({
      spindleCw: true,
      spindleCcw: false,
      flood: true,
      mist: false,
    });

    handleLine(set, get, refs, async () => undefined, '<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(get().accessoryCache?.spindleCw).toBe(true);

    handleLine(
      set,
      get,
      refs,
      async () => undefined,
      '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>',
    );
    expect(get().accessoryCache).toEqual({
      spindleCw: false,
      spindleCcw: false,
      flood: false,
      mist: false,
    });
  });

  it('clears the cache when the controller enters Alarm', () => {
    const { refs, set, get } = makeHarness();
    handleLine(
      set,
      get,
      refs,
      async () => undefined,
      '<Idle|MPos:0.000,0.000,0.000|FS:0,8000|Ov:100,100,100|A:S>',
    );
    expect(get().accessoryCache).not.toBeNull();
    handleLine(set, get, refs, async () => undefined, '<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(get().accessoryCache).toBeNull();
  });
});

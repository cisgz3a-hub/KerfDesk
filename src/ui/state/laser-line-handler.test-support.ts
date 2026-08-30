import { startCollecting } from '../../core/controllers/grbl';
import { grblDriver } from '../../core/controllers';
import type { LaserState } from './laser-store';
import type { GetFn, HandlerRefs, SetFn } from './laser-line-shared';

function makeLaserState(): LaserState {
  return { ...makeLaserStateFields(), ...makeLaserStateActions() } as LaserState;
}

function makeLaserStateFields() {
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
    pauseResumeTransition: null,
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
    controllerBuildInfo: null,
    controllerBuildInfoRawLines: [],
    controllerBuildInfoObservation: null,
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
    framedRunStartClaim: null,
  };
}

function makeLaserStateActions() {
  return {
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

/** Creates isolated mutable state and controller refs for line-pipeline tests. */
export function makeLineHandlerHarness(): {
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

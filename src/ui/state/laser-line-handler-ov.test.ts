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
    alarmCode: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    airAssistOn: false,
    autofocusBusy: false,
    probeBusy: false,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
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
    setAirAssistEnabled: async () => undefined,
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
});

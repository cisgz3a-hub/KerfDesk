import { describe, expect, it, vi } from 'vitest';
import { startCollecting } from '../../core/controllers/grbl';
import type { FrameVerification } from './frame-verification';
import { handleLine, type GetFn, type HandlerRefs, type SetFn } from './laser-line-handler';
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
    expect(get().motionOperation).toBeNull();
    expect(get().frameVerification).toBeNull();
  });
});

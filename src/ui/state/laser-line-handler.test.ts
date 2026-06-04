import { describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  idleCollector,
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
    streamer: null,
    log: [],
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

    for (const line of ['$30=255', '$31=0', '$32=1', 'ok']) {
      handleLine(set, get, refs, async () => undefined, line);
    }

    expect(refs.settingsCollector).toEqual(idleCollector());
    expect(get().detectedSettings).toMatchObject({
      maxPowerS: 255,
      minPowerS: 0,
      laserModeEnabled: true,
    });
    expect(get().controllerSettings).toMatchObject({
      maxPowerS: 255,
      minPowerS: 0,
      laserModeEnabled: true,
    });
  });
});

describe('handleLine streamer writes', () => {
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
});

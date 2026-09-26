import { describe, expect, it, vi } from 'vitest';
import {
  CncLiftLineRefusedError,
  failCncPauseLift,
  type CncPauseLiftContext,
} from './cnc-pause-lift-commands';
import { currentStreamResetMayLosePosition } from './job-stop-request';
import type { LaserState } from './laser-store';

const TOKEN = 7;

// The stop a failed lift sends is judged against the lift still on record
// (ADR-215 Amendment 1): the last report read Idle, as it does between the
// lift's reset and its first move.
function failingLift() {
  let state = {
    cncPauseLift: { token: TOKEN, phase: 'lifting', streamerEpoch: 5 },
    streamer: { status: 'paused' },
    streamerEpoch: 5,
    statusReport: { state: 'Idle', subState: null },
    pauseResumeTransition: null,
    streamReset: null,
    safetyNotice: null,
    log: [],
  } as unknown as LaserState;
  const failDarkStop = vi.fn(async () => undefined);
  const context = {
    get: () => state,
    set: (patch: Partial<LaserState> | ((current: LaserState) => Partial<LaserState>)) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    },
    failDarkStop,
  } as unknown as CncPauseLiftContext;
  return { context, read: () => state, failDarkStop };
}

describe('failCncPauseLift', () => {
  it('records that a lift move may still be running when the lift fails', async () => {
    const lift = failingLift();
    await failCncPauseLift(lift.context, TOKEN, new Error('The bit did not reach Z5.000.'));
    expect(currentStreamResetMayLosePosition(lift.read())).toBe(true);
    expect(lift.read().cncPauseLift).toBeNull();
    expect(lift.failDarkStop).toHaveBeenCalledOnce();
  });

  it('leaves the verdict to the report when the controller refused the line', async () => {
    const lift = failingLift();
    const refused = new CncLiftLineRefusedError('G0 Z5.000', 'error:33');
    await failCncPauseLift(lift.context, TOKEN, refused);
    expect(currentStreamResetMayLosePosition(lift.read())).toBe(false);
    expect(lift.read().safetyNotice?.kind).toBe('cnc-pause-lift-failed');
    expect(lift.failDarkStop).toHaveBeenCalledOnce();
  });
});

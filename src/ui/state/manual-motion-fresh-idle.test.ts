import { describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { observeFreshControllerStatus } from './laser-controller-status-wait';
import type { LaserState, LiveRefs } from './laser-store';
import {
  confirmFreshManualMotionIdle,
  MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE,
} from './manual-motion-fresh-idle';

const idle = { state: 'Idle' } as StatusReport;

describe('manual motion fresh Idle transport fence', () => {
  it('reuses only a fresh same-session position observation', async () => {
    const state = fixtureState();
    const write = vi.fn(async () => undefined);
    await expect(
      confirmFreshManualMotionIdle({
        get: () => state,
        refs: fixtureRefs(),
        write,
        action: 'jog',
        now: () => 1_500,
      }),
    ).resolves.toBe(idle);
    expect(write).not.toHaveBeenCalled();
  });

  it('turns stale silence into an actionable status error', async () => {
    const state = fixtureState({ observedAt: 0 });
    await expect(
      confirmFreshManualMotionIdle({
        get: () => state,
        refs: fixtureRefs(),
        write: async () => undefined,
        action: 'frame',
        timeoutMs: 5,
        now: () => 10_000,
      }),
    ).rejects.toThrow(MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE);
  });

  it('ignores delayed pre-query status and rejects a fresh non-Idle report', async () => {
    let state = fixtureState({ observedAt: 0 });
    const refs = fixtureRefs();
    const pending = confirmFreshManualMotionIdle({
      get: () => state,
      refs,
      write: async () => undefined,
      action: 'jog',
      timeoutMs: 100,
      now: () => 10_000,
    });
    await Promise.resolve();
    observeFreshControllerStatus(refs, { sessionEpoch: 7, sequence: 10 }, idle);
    const run = { ...idle, state: 'Run' } as StatusReport;
    state = { ...state, statusSequence: 11, statusReport: run };
    observeFreshControllerStatus(refs, { sessionEpoch: 7, sequence: 11 }, run);
    await expect(pending).rejects.toThrow('fresh Idle report; the controller reported Run');
  });

  it('does not reuse a status report across reconnect epochs', async () => {
    let state = fixtureState({ observedAt: 0 });
    const refs = fixtureRefs();
    const pending = confirmFreshManualMotionIdle({
      get: () => state,
      refs,
      write: async () => undefined,
      action: 'origin',
      timeoutMs: 100,
      now: () => 10_000,
    });
    await Promise.resolve();
    state = { ...state, controllerSessionEpoch: 8, statusSequence: 11 };
    observeFreshControllerStatus(refs, { sessionEpoch: 8, sequence: 11 }, idle);
    await expect(pending).rejects.toThrow('Controller session changed');
  });

  it('permits motion after a matching fresh Idle report', async () => {
    let state = fixtureState({ observedAt: 0 });
    const refs = fixtureRefs();
    const write = vi.fn(async () => undefined);
    const pending = confirmFreshManualMotionIdle({
      get: () => state,
      refs,
      write,
      action: 'jog',
      timeoutMs: 100,
      now: () => 10_000,
    });
    await Promise.resolve();
    state = { ...state, statusSequence: 11, statusReport: idle };
    observeFreshControllerStatus(refs, { sessionEpoch: 7, sequence: 11 }, idle);
    await expect(pending).resolves.toBe(idle);
    expect(write).toHaveBeenCalledWith('?', 'jog', 'motion');
  });
});

function fixtureState(observation: { observedAt: number } = { observedAt: 1_000 }): LaserState {
  return {
    controllerSessionEpoch: 7,
    trustedPositionEpoch: 3,
    statusSequence: 10,
    statusReport: idle,
    statusObservation: {
      sessionEpoch: 7,
      positionEpoch: 3,
      sequence: 10,
      observedAt: observation.observedAt,
    },
  } as LaserState;
}

function fixtureRefs(): LiveRefs {
  return {
    driver: { realtime: { statusQuery: '?' } },
    controllerStatusWait: null,
  } as LiveRefs;
}

import { describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { observeFreshControllerStatus } from './laser-controller-status-wait';
import type { LaserState, LiveRefs } from './laser-store';
import {
  confirmFreshManualMotionIdle,
  MANUAL_MOTION_STATUS_TIMEOUT_MESSAGE,
  MANUAL_MOTION_STATUS_UNAVAILABLE_MESSAGE,
} from './manual-motion-fresh-idle';
import {
  cancelPendingManualMotions,
  MANUAL_MOTION_CANCELLED_MESSAGE,
  manualMotionCancelGeneration,
} from './manual-motion-intent';

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

// Audit status-5 / settings-console-6: Marlin's only status source is the
// queued M114, which reports position and then owes its own `ok`
// (https://marlinfw.org/docs/gcode/M114.html).
describe('manual motion fresh Idle on a queued-status driver', () => {
  it('sends the queued query and returns only after that query acknowledges', async () => {
    vi.useFakeTimers();
    try {
      let state = { ...fixtureState({ observedAt: 0 }), pendingUntrackedAcks: 0 } as LaserState;
      const refs = queuedStatusRefs('M114');
      const write = vi.fn(async () => {
        state = { ...state, pendingUntrackedAcks: 1 } as LaserState;
      });
      let settled = false;
      const pending = confirmFreshManualMotionIdle({
        get: () => state,
        refs,
        write,
        action: 'jog',
        now: () => 10_000,
      }).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(write).toHaveBeenCalledWith('M114\n', 'jog', 'motion');

      // The position report arrives before the query's own ok.
      state = { ...state, statusSequence: 11, statusReport: idle } as LaserState;
      observeFreshControllerStatus(refs, { sessionEpoch: 7, sequence: 11 }, idle);
      await vi.advanceTimersByTimeAsync(50);
      expect(settled).toBe(false);

      state = { ...state, pendingUntrackedAcks: 0 } as LaserState;
      await vi.advanceTimersByTimeAsync(20);
      await expect(pending).resolves.toBe(idle);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says no query was possible when the driver has no status query at all', async () => {
    const write = vi.fn(async () => undefined);
    await expect(
      confirmFreshManualMotionIdle({
        get: () => fixtureState({ observedAt: 0 }),
        refs: queuedStatusRefs(null),
        write,
        action: 'console',
        now: () => 10_000,
      }),
    ).rejects.toThrow(MANUAL_MOTION_STATUS_UNAVAILABLE_MESSAGE);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('manual motion fresh Idle and Cancel (audit jog-home-origin-2)', () => {
  it('fails a jog readiness query at once when the operator cancels', async () => {
    const state = fixtureState({ observedAt: 0 });
    const refs = fixtureRefs();
    const pending = confirmFreshManualMotionIdle({
      get: () => state,
      refs,
      write: async () => undefined,
      action: 'jog',
      timeoutMs: 60_000,
      now: () => 10_000,
      cancelGeneration: manualMotionCancelGeneration(refs),
    });
    await Promise.resolve();
    expect(refs.controllerStatusWait).not.toBeNull();

    cancelPendingManualMotions(refs);

    await expect(pending).rejects.toThrow(MANUAL_MOTION_CANCELLED_MESSAGE);
    expect(refs.controllerStatusWait).toBeNull();
  });

  it('leaves a readiness wait that Cancel does not own alone', async () => {
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

    cancelPendingManualMotions(refs);
    state = { ...state, statusSequence: 11, statusReport: idle };
    observeFreshControllerStatus(refs, { sessionEpoch: 7, sequence: 11 }, idle);

    await expect(pending).resolves.toBe(idle);
  });
});

function queuedStatusRefs(queuedStatusQuery: string | null): LiveRefs {
  return {
    driver: { realtime: { statusQuery: null }, commands: { queuedStatusQuery } },
    controllerStatusWait: null,
  } as unknown as LiveRefs;
}

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

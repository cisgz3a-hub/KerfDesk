// Controller qualification must wait for an operator who is clearing an Alarm,
// and resume after an in-session Alarm or Sleep during the connect handshake
// (controller audit 2026-09-23, connect-2 / connect-3). A Stop mid-motion makes
// GRBL reboot into ALARM:3 and a board that does not reset on open can already
// be locked in Alarm; both used to leave qualification failed or stuck with
// nothing re-arming it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  qualifyingController,
  resumeQualificationInSession,
  scheduleControllerQualification,
  type ControllerQualificationScheduleRefs,
} from './laser-controller-qualification';
import type { LaserState } from './laser-store';

type Harness = {
  state: LaserState;
  readonly set: (patch: Partial<LaserState> | ((s: LaserState) => Partial<LaserState>)) => void;
  readonly get: () => LaserState;
  readonly refs: ControllerQualificationScheduleRefs & {
    runControllerQualification: () => Promise<void>;
  };
  readonly run: ReturnType<typeof vi.fn>;
};

function harness(): Harness {
  const connection = {};
  const run = vi.fn(async () => undefined);
  const h = {
    state: {
      connection: { kind: 'connected' },
      controllerSessionEpoch: 4,
      controllerQualification: qualifyingController(4, 'reset-cleanup'),
      controllerOperation: null,
      motionOperation: null,
      pendingUntrackedAcks: 0,
      pendingTransportWrites: 0,
      streamer: null,
      statusReport: null,
      statusObservation: null,
    } as unknown as LaserState,
    refs: { connection, runControllerQualification: run } as Harness['refs'],
    run,
  } as unknown as Harness;
  Object.assign(h, {
    get: () => h.state,
    set: (patch: Partial<LaserState> | ((s: LaserState) => Partial<LaserState>)) => {
      h.state = { ...h.state, ...(typeof patch === 'function' ? patch(h.state) : patch) };
    },
  });
  return h;
}

function report(h: Harness, state: 'Alarm' | 'Sleep' | 'Idle'): void {
  h.state = {
    ...h.state,
    statusReport: { state } as LaserState['statusReport'],
    statusObservation: { sessionEpoch: 4, positionEpoch: 0, sequence: 1, observedAt: Date.now() },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('qualification while the controller waits for the operator', () => {
  it('keeps waiting through fresh Alarm reports and qualifies on the first Idle', async () => {
    vi.useFakeTimers();
    const h = harness();
    report(h, 'Alarm');
    scheduleControllerQualification(h.set, h.get, h.refs, 4);

    // Well past the 8 s deadline, with the controller answering Alarm each second.
    for (let second = 0; second < 20; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      report(h, 'Alarm');
    }
    expect(h.state.controllerQualification.kind).toBe('qualifying');
    expect(h.run).not.toHaveBeenCalled();

    report(h, 'Idle');
    await vi.advanceTimersByTimeAsync(100);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it('still fails when the controller stops reporting altogether', async () => {
    vi.useFakeTimers();
    const h = harness();
    report(h, 'Alarm');
    scheduleControllerQualification(h.set, h.get, h.refs, 4);

    await vi.advanceTimersByTimeAsync(20_000);

    expect(h.state.controllerQualification.kind).toBe('failed');
  });

  it('hands a handshake ended by an in-session Alarm to the scheduler', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.state = {
      ...h.state,
      controllerQualification: qualifyingController(4, 'controller-response'),
    };
    report(h, 'Alarm');

    resumeQualificationInSession(h.set, h.get, h.refs, h.refs.connection, 4);
    expect(h.state.controllerQualification).toEqual(qualifyingController(4, 'reset-cleanup'));

    report(h, 'Idle');
    await vi.advanceTimersByTimeAsync(100);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  // Audit TC-1: a controller still busy when the connect handshake hands over
  // is as alive as one waiting in Alarm.
  it.each(['Run', 'Jog', 'Home', 'Hold', 'Door', 'Check'] as const)(
    'keeps waiting through fresh %s reports and qualifies on the first Idle',
    async (busy) => {
      vi.useFakeTimers();
      const h = harness();
      scheduleControllerQualification(h.set, h.get, h.refs, 4);
      for (let second = 0; second < 20; second += 1) {
        h.state = { ...h.state, statusReport: { state: busy } as LaserState['statusReport'] };
        h.state = {
          ...h.state,
          statusObservation: {
            sessionEpoch: 4,
            positionEpoch: 0,
            sequence: 1,
            observedAt: Date.now(),
          },
        };
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(h.state.controllerQualification.kind).toBe('qualifying');

      report(h, 'Idle');
      await vi.advanceTimersByTimeAsync(100);
      expect(h.run).toHaveBeenCalledTimes(1);
    },
  );

  // The store clears the status observation on every Alarm or Sleep report
  // (laser-status-line handleInvalidatingStatus); the report sequence still
  // moves, and that alone proves the controller is answering.
  it('counts Alarm reports that carry no status observation by the moving report sequence', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.state = { ...h.state, statusSequence: 0 };
    scheduleControllerQualification(h.set, h.get, h.refs, 4);
    for (let second = 0; second < 20; second += 1) {
      h.state = {
        ...h.state,
        statusReport: { state: 'Alarm' } as LaserState['statusReport'],
        statusObservation: null,
        statusSequence: h.state.statusSequence + 1,
      };
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(h.state.controllerQualification.kind).toBe('qualifying');

    await vi.advanceTimersByTimeAsync(9_000);
    expect(h.state.controllerQualification.kind).toBe('failed');
  });

  it('leaves a different connection or session alone', () => {
    const h = harness();
    h.state = {
      ...h.state,
      controllerQualification: qualifyingController(4, 'controller-response'),
    };
    resumeQualificationInSession(h.set, h.get, h.refs, {}, 4);
    resumeQualificationInSession(h.set, h.get, h.refs, h.refs.connection, 3);
    expect(h.state.controllerQualification).toEqual(qualifyingController(4, 'controller-response'));
  });
});

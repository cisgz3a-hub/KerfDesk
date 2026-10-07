import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelScheduledControllerQualification,
  qualifiedController,
  qualifyingController,
  scheduleControllerQualification,
  type ControllerQualificationScheduleRefs,
} from './laser-controller-qualification';
import { useLaserStore, type LaserState } from './laser-store';

type MutableScheduleRefs = {
  -readonly [Key in keyof ControllerQualificationScheduleRefs]: ControllerQualificationScheduleRefs[Key];
};

function harness(overrides: Partial<LaserState> = {}) {
  const epoch = 7;
  let state: LaserState = {
    ...useLaserStore.getState(),
    connection: { kind: 'connected' },
    controllerSessionEpoch: epoch,
    controllerQualification: qualifyingController(epoch, 'reset-cleanup'),
    statusReport: { state: 'Idle' } as LaserState['statusReport'],
    statusSequence: 10,
    statusObservation: { sessionEpoch: epoch, positionEpoch: 0, sequence: 10, observedAt: 0 },
    controllerOperation: null,
    motionOperation: null,
    streamer: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    fireActive: false,
    autofocusBusy: false,
    ...overrides,
  };
  const set = (
    partial: Partial<LaserState> | ((current: LaserState) => Partial<LaserState> | LaserState),
  ) => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };
  const run = vi.fn(async () => {
    set({ controllerQualification: qualifiedController(epoch, 'verified') });
  });
  const refs: MutableScheduleRefs = {
    connection: {},
    pendingResetCleanup: null,
    controllerCommand: null,
    settingsCollector: { kind: 'idle' },
    qualificationTimer: null,
    runControllerQualification: run,
  };
  const observe = (controllerState: string) => {
    const sequence = state.statusSequence + 1;
    set({
      statusReport: { state: controllerState } as LaserState['statusReport'],
      statusSequence: sequence,
      statusObservation:
        controllerState === 'Alarm' || controllerState === 'Sleep'
          ? null
          : {
              sessionEpoch: epoch,
              positionEpoch: 0,
              sequence,
              observedAt: Date.now(),
            },
    });
  };
  const observeIdle = () => observe('Idle');
  return { epoch, get: () => state, set, refs, run, observe, observeIdle };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('automatic controller information scheduling', () => {
  it('reads once from fresh current-session Idle without needing a startup banner', async () => {
    const h = harness();
    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(h.run).toHaveBeenCalledOnce();
    expect(h.get().controllerQualification.kind).toBe('qualified');
    expect(h.refs.qualificationTimer).toBeNull();
  });

  it.each(['Alarm', 'Sleep', 'Run', 'Hold'])(
    'waits through %s and recovers automatically when the same connection reports Idle',
    async (controllerState) => {
      const h = harness({
        statusReport: { state: controllerState } as LaserState['statusReport'],
        statusObservation: null,
      });
      const connection = h.refs.connection;
      scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);

      for (let response = 0; response < 6; response += 1) {
        h.observe(controllerState);
        await vi.advanceTimersByTimeAsync(5_000);
      }

      expect(h.run).not.toHaveBeenCalled();
      expect(h.get().controllerQualification.kind).toBe('qualifying');
      h.observeIdle();
      await vi.advanceTimersByTimeAsync(100);

      expect(h.run).toHaveBeenCalledOnce();
      expect(h.refs.connection).toBe(connection);
      expect(h.get().controllerQualification.kind).toBe('qualified');
    },
  );

  it.each(['Alarm', 'Sleep'])(
    'reports silence after a retained %s response and resumes when fresh Idle arrives',
    async (controllerState) => {
      const h = harness({
        statusReport: { state: controllerState } as LaserState['statusReport'],
        statusObservation: null,
      });
      const connection = h.refs.connection;
      scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);

      await vi.advanceTimersByTimeAsync(8_000);

      expect(h.run).not.toHaveBeenCalled();
      expect(h.get().controllerQualification).toMatchObject({ kind: 'failed', epoch: h.epoch });
      expect(h.get().statusReport?.state).toBe(controllerState);
      h.observeIdle();
      await vi.advanceTimersByTimeAsync(100);

      expect(h.run).toHaveBeenCalledOnce();
      expect(h.refs.connection).toBe(connection);
      expect(h.get().controllerQualification.kind).toBe('qualified');
    },
  );

  it('reports missing fresh status after a bounded wait and resumes when a response arrives', async () => {
    const h = harness({ statusReport: null, statusObservation: null });
    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);

    await vi.advanceTimersByTimeAsync(8_000);

    expect(h.run).not.toHaveBeenCalled();
    expect(h.get().controllerQualification).toMatchObject({ kind: 'failed', epoch: h.epoch });
    h.observeIdle();
    await vi.advanceTimersByTimeAsync(100);

    expect(h.run).toHaveBeenCalledOnce();
    expect(h.get().controllerQualification.kind).toBe('qualified');
  });

  it('does not promote an Idle observation from the previous session', async () => {
    const h = harness({
      statusObservation: { sessionEpoch: 6, positionEpoch: 0, sequence: 10, observedAt: 0 },
    });
    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);

    await vi.advanceTimersByTimeAsync(100);

    expect(h.run).not.toHaveBeenCalled();
    h.observeIdle();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.run).toHaveBeenCalledOnce();
  });

  it('preserves deferred reset cleanup and real acknowledgement debt before reading', async () => {
    const h = harness();
    h.refs.pendingResetCleanup = {};
    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);

    await vi.advanceTimersByTimeAsync(500);
    expect(h.run).not.toHaveBeenCalled();
    h.refs.pendingResetCleanup = null;
    h.set({ pendingUntrackedAcks: 1 });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(h.run).not.toHaveBeenCalled();
    expect(h.get().pendingUntrackedAcks).toBe(1);
    expect(h.get().controllerQualification).toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('acknowledgement'),
    });
    h.set({ pendingUntrackedAcks: 0 });
    await vi.advanceTimersByTimeAsync(100);

    expect(h.run).toHaveBeenCalledOnce();
  });

  it('does not count completed status-poll transport as progress on a missing cleanup ACK', async () => {
    const h = harness({ pendingUntrackedAcks: 1 });
    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);
    for (let poll = 0; poll < 20; poll += 1) {
      h.set({ pendingTransportWrites: 1 });
      await vi.advanceTimersByTimeAsync(100);
      h.set({ pendingTransportWrites: 0 });
      h.observeIdle();
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(h.get().controllerQualification).toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('acknowledgement'),
    });
    expect(h.get().pendingUntrackedAcks).toBe(1);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('preserves a manual Home busy allowance before bounding its leftover ACK debt', async () => {
    const h = harness({
      controllerOperation: { kind: 'home', phase: 'awaiting-idle', idleReports: 0, operationId: 1 },
      pendingUntrackedAcks: 1,
    });
    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);
    for (let response = 0; response < 6; response += 1) {
      h.observe('Home');
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(h.run).not.toHaveBeenCalled();
    expect(h.get().controllerQualification.kind).toBe('qualifying');
    expect(h.get().pendingUntrackedAcks).toBe(1);
    h.set({ controllerOperation: null });
    h.observeIdle();
    await vi.advanceTimersByTimeAsync(7_000);
    expect(h.get().controllerQualification.kind).toBe('qualifying');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.get().controllerQualification).toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('acknowledgement'),
    });
    expect(h.get().pendingUntrackedAcks).toBe(1);
    h.set({ pendingUntrackedAcks: 0 });
    h.observeIdle();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.run).toHaveBeenCalledOnce();
  });

  it('defers to the initial handshake and never duplicates its settings read', async () => {
    const h = harness({
      controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
    });
    h.refs.controllerCommand = {};
    h.refs.settingsCollector = { kind: 'collecting' };
    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);

    await vi.advanceTimersByTimeAsync(500);
    expect(h.run).not.toHaveBeenCalled();
    h.set({
      controllerOperation: null,
      controllerQualification: qualifiedController(h.epoch, 'verified'),
    });
    h.refs.controllerCommand = null;
    h.refs.settingsCollector = { kind: 'idle' };
    await vi.advanceTimersByTimeAsync(100);

    expect(h.run).not.toHaveBeenCalled();
    expect(h.refs.qualificationTimer).toBeNull();
  });

  it('does not automatically retry an empty or rejected settings response', async () => {
    const h = harness();
    h.refs.runControllerQualification = vi.fn(async () => {
      h.set({ controllerQualification: { kind: 'failed', epoch: h.epoch, message: 'empty $$' } });
    });
    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);

    await vi.advanceTimersByTimeAsync(500);
    h.observeIdle();
    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(h.refs.runControllerQualification).toHaveBeenCalledOnce();
    expect(h.get().controllerQualification).toMatchObject({ kind: 'failed', message: 'empty $$' });
  });

  it('cancels recovery on a changed connection or explicit teardown', async () => {
    const h = harness({ statusReport: null, statusObservation: null });
    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);
    h.refs.connection = {};
    h.observeIdle();
    await vi.advanceTimersByTimeAsync(100);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.refs.qualificationTimer).toBeNull();

    scheduleControllerQualification(h.set, h.get, h.refs, h.epoch);
    cancelScheduledControllerQualification(h.refs);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.run).not.toHaveBeenCalled();
  });
});

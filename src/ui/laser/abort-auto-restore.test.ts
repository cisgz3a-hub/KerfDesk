// The automatic origin restore after the operator's Abort (user annoyance
// audit A3-D-1, ADR-341 Amendment 14): which Abort qualifies, each case that
// must keep the card, and that it runs once per Abort and never after the
// operator pressed a card button.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import type { JobStopRequest } from '../state/job-stop-request';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { restoreOriginAfterAbort } from './abort-alarm-recovery';
import type * as AbortAlarmRecovery from './abort-alarm-recovery';
import {
  ABORT_AUTO_RESTORE_FAILED_LABEL,
  ABORT_AUTO_RESTORE_WINDOW_MS,
  ABORT_ORIGIN_RESTORED_MESSAGE,
  installAbortAutoRestore,
  noteOperatorAbortRecovery,
  useAbortAutoRestoreStore,
} from './abort-auto-restore';
import {
  abortAutoRestoreVerdict,
  type AbortAutoRestoreProfile,
} from './abort-auto-restore-eligibility';
import { PAUSE_THEN_ABORT_NOTE, pauseControlMessage, pauseControlTitle } from './job-control-copy';

vi.mock('./abort-alarm-recovery', async (importOriginal) => ({
  ...(await importOriginal<typeof AbortAlarmRecovery>()),
  restoreOriginAfterAbort: vi.fn(async () => undefined),
}));

const original = useLaserStore.getState();
const SAVED = { x: 20, y: 30 };
const PROFILE: AbortAutoRestoreProfile = {
  homingEnabled: false,
  machineKind: 'laser',
  rotaryActive: false,
};

/** A new stop request per test: the once-only record is keyed by the object. */
function request(overrides: Partial<JobStopRequest> = {}): JobStopRequest {
  return {
    reason: 'operator',
    streamerEpoch: 4,
    originAtStopMm: SAVED,
    originMachineZeroEpoch: 2,
    jobMachineKind: 'laser',
    ...overrides,
  };
}

const ALARM_REPORT: StatusReport = {
  state: 'Alarm',
  subState: null,
  mPos: { x: 41, y: 37, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

/** The store as an operator Abort leaves a stock GRBL laser without homing:
 *  ALARM:3 reported, the origin cleared, nothing in flight. */
function aborted(stop: JobStopRequest, overrides: Partial<LaserState> = {}): LaserState {
  return {
    ...original,
    connection: { kind: 'connected' },
    activeControllerKind: 'grbl-v1.1',
    alarmCode: 3,
    streamerEpoch: 4,
    jobStopRequest: stop,
    streamReset: { streamerEpoch: 4, positionMayBeLost: true },
    machineZeroEpoch: 2,
    statusReport: ALARM_REPORT,
    statusSequence: 10,
    workOriginActive: false,
    workOriginSource: 'none',
    ...overrides,
  };
}

function verdictFor(
  overrides: Partial<LaserState> = {},
  stop: Partial<JobStopRequest> = {},
  profile: Partial<AbortAutoRestoreProfile> = {},
): ReturnType<typeof abortAutoRestoreVerdict> {
  return abortAutoRestoreVerdict(aborted(request(stop), overrides), { ...PROFILE, ...profile });
}

describe('abortAutoRestoreVerdict', () => {
  it("restores for the operator's Abort of a laser job on a machine without homing", () => {
    const stop = request();
    expect(abortAutoRestoreVerdict(aborted(stop), PROFILE)).toEqual({
      kind: 'restore',
      request: stop,
      savedMm: SAVED,
    });
    expect(verdictFor({ activeControllerKind: 'fluidnc' }).kind).toBe('restore');
  });

  it('waits until the controller reports Alarm with nothing in flight', () => {
    expect(verdictFor({ statusReport: null }).kind).toBe('wait');
    expect(verdictFor({ statusReport: { ...ALARM_REPORT, state: 'Idle' } }).kind).toBe('wait');
    expect(verdictFor({ pendingUntrackedAcks: 1 }).kind).toBe('wait');
    expect(verdictFor({ autofocusBusy: true }).kind).toBe('wait');
    expect(verdictFor({ connection: { kind: 'disconnected' } }).kind).toBe('wait');
    expect(
      verdictFor({
        controllerOperation: { kind: 'autofocus', phase: 'preflight', idleReports: 0 },
      }).kind,
    ).toBe('wait');
  });

  it.each([
    ['another alarm code', { alarmCode: 2 }, {}, {}, 'not-the-operator-abort-alarm'],
    ['an alarm with no Abort', { jobStopRequest: null }, {}, {}, 'not-the-operator-abort-alarm'],
    ['an earlier stream', { streamerEpoch: 5 }, {}, {}, 'not-the-operator-abort-alarm'],
    ['no reset of this stream', { streamReset: null }, {}, {}, 'not-the-operator-abort-alarm'],
    [
      'the app closing, not the operator',
      {},
      { reason: 'app-closing' },
      {},
      'not-the-operator-abort-alarm',
    ],
    [
      'a reset recorded as not into motion',
      { streamReset: { streamerEpoch: 4, positionMayBeLost: false } },
      {},
      {},
      'reset-not-into-motion',
    ],
    ['a CNC job', {}, { jobMachineKind: 'cnc' }, {}, 'not-a-laser-job'],
    ['a job of unrecorded kind', {}, { jobMachineKind: undefined }, {}, 'not-a-laser-job'],
    ['a project switched to CNC', {}, {}, { machineKind: 'cnc' }, 'not-a-laser-job'],
    ['no saved origin', {}, { originAtStopMm: undefined }, {}, 'no-saved-origin'],
    ['a rotary on its own axis', {}, { rotaryStartTurn: { axis: 'A', machine: 12 } }, {}, 'rotary'],
    ['a rotary on Y', {}, {}, { rotaryActive: true }, 'rotary'],
    ['a profile with homing', {}, {}, { homingEnabled: true }, 'homing-on'],
    ['a moved machine zero', { machineZeroEpoch: 3 }, {}, {}, 'machine-zero-moved'],
    ['a reset-required latch', { resetRequired: true }, {}, {}, 'reset-required'],
    ['a stuck homing state', { resetRequired: 'homing-state' }, {}, {}, 'reset-required'],
    [
      'a controller without Unlock',
      { capabilities: { ...original.capabilities, unlock: false } },
      {},
      {},
      'no-unlock',
    ],
    ['grblHAL', { activeControllerKind: 'grblhal' }, {}, {}, 'controller-keeps-origin'],
    [
      'a safety notice',
      { safetyNotice: { kind: 'disconnect-stop-unconfirmed', message: 'x' } },
      {},
      {},
      'fault-notice',
    ],
    [
      'an open door',
      {
        statusReport: {
          ...ALARM_REPORT,
          pins: { limitX: false, limitY: false, limitZ: false, probe: false, door: true },
        },
      },
      {},
      {},
      'door-or-estop',
    ],
    [
      'an E-stop input',
      {
        statusReport: {
          ...ALARM_REPORT,
          pins: {
            limitX: false,
            limitY: false,
            limitZ: false,
            probe: false,
            door: false,
            estop: true,
          },
        },
      },
      {},
      {},
      'door-or-estop',
    ],
    ['an origin set again', { workOriginActive: true }, {}, {}, 'operator-acted'],
    ['an unlock already sent', { positionEvidenceSuppressed: true }, {}, {}, 'operator-acted'],
  ] as const)('keeps the card for %s', (_name, laser, stop, profile, reason) => {
    expect(
      verdictFor(
        laser as Partial<LaserState>,
        stop as Partial<JobStopRequest>,
        profile as Partial<AbortAutoRestoreProfile>,
      ),
    ).toEqual({ kind: 'card', reason });
  });
});

describe('installAbortAutoRestore', () => {
  let uninstall = (): void => undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    useLaserStore.setState(original, true);
    uninstall = installAbortAutoRestore();
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
    useLaserStore.setState(original, true);
    useToastStore.setState({ toasts: [] });
    useAbortAutoRestoreStore.setState({ running: null, failure: null });
    vi.mocked(restoreOriginAfterAbort).mockReset().mockResolvedValue(undefined);
  });

  /** The alarm arrives, then two status reports show it settled. */
  async function settleAlarm(stop: JobStopRequest, laser: Partial<LaserState> = {}): Promise<void> {
    useLaserStore.setState(aborted(stop, { statusReport: null, ...laser }), true);
    useLaserStore.setState({ statusReport: ALARM_REPORT, statusSequence: 11 });
    await vi.advanceTimersByTimeAsync(0);
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 12 });
    await vi.advanceTimersByTimeAsync(0);
  }

  it('restores once the alarm has been seen settled on two reports, and says so', async () => {
    const stop = request();
    useLaserStore.setState(aborted(stop, { statusReport: null }), true);
    useLaserStore.setState({ statusReport: ALARM_REPORT, statusSequence: 11 });
    await vi.advanceTimersByTimeAsync(0);
    // One report is not settled: the app may still send its own query.
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 12 });
    await vi.advanceTimersByTimeAsync(0);

    // The card's own action, without Home and without a rotary turn.
    expect(restoreOriginAfterAbort).toHaveBeenCalledTimes(1);
    expect(restoreOriginAfterAbort).toHaveBeenCalledWith(SAVED, false);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ message: ABORT_ORIGIN_RESTORED_MESSAGE, variant: 'info' }),
    ]);
    expect(ABORT_ORIGIN_RESTORED_MESSAGE).toBe(
      'Stopped. The laser is off and your origin is restored. Frame to check before starting again.',
    );
  });

  it('starts over when something goes in flight between the two reports', async () => {
    const stop = request();
    useLaserStore.setState(aborted(stop), true);
    useLaserStore.setState({ pendingUntrackedAcks: 1, statusSequence: 11 });
    useLaserStore.setState({ pendingUntrackedAcks: 0, statusSequence: 12 });
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
    useLaserStore.setState({ statusSequence: 13 });
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreOriginAfterAbort).toHaveBeenCalledTimes(1);
  });

  it('runs once per Abort, however long the alarm stays', async () => {
    const stop = request();
    vi.mocked(restoreOriginAfterAbort).mockRejectedValueOnce(new Error('error:8'));
    await settleAlarm(stop);
    expect(restoreOriginAfterAbort).toHaveBeenCalledTimes(1);
    for (let sequence = 13; sequence < 40; sequence += 1) {
      useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: sequence });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(restoreOriginAfterAbort).toHaveBeenCalledTimes(1);
  });

  it('says a failed restore did not happen and leaves it to the card', async () => {
    const stop = request();
    vi.mocked(restoreOriginAfterAbort).mockRejectedValueOnce(new Error('The door is open.'));
    await settleAlarm(stop);
    expect(useAbortAutoRestoreStore.getState()).toEqual({
      running: null,
      failure: { request: stop, reason: 'The door is open.' },
    });
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'error',
        message: `${ABORT_AUTO_RESTORE_FAILED_LABEL}: The door is open.`,
      }),
    ]);
  });

  it('never runs after the operator pressed a card button', async () => {
    const stop = request();
    useLaserStore.setState(aborted(stop, { statusReport: null }), true);
    useLaserStore.setState({ statusReport: ALARM_REPORT, statusSequence: 11 });
    noteOperatorAbortRecovery(stop);
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 12 });
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 13 });
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
  });

  it('does not come back for a case that kept the card, once the case passes', async () => {
    const stop = request();
    // A safety notice at the alarm: the card stays, for good.
    await settleAlarm(stop, {
      safetyNotice: { kind: 'disconnect-stop-unconfirmed', message: 'x' },
    });
    useLaserStore.setState({ safetyNotice: null, statusSequence: 13 });
    useLaserStore.setState({ statusSequence: 14 });
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
  });

  it('gives up when the controller has not settled within the window', async () => {
    const stop = request();
    useLaserStore.setState(aborted(stop, { statusReport: null }), true);
    await vi.advanceTimersByTimeAsync(ABORT_AUTO_RESTORE_WINDOW_MS + 1);
    useLaserStore.setState({ statusReport: ALARM_REPORT, statusSequence: 11 });
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 12 });
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 13 });
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
  });

  it('needs the alarm within the window after the Abort itself', async () => {
    const stop = request();
    useLaserStore.setState(aborted(stop, { alarmCode: null, statusReport: null }), true);
    await vi.advanceTimersByTimeAsync(ABORT_AUTO_RESTORE_WINDOW_MS + 1);
    useLaserStore.setState({ alarmCode: 3, statusReport: ALARM_REPORT, statusSequence: 11 });
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 12 });
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 13 });
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
  });

  it('is over once the alarm was cleared: a later ALARM:3 on the same stop request keeps the card', async () => {
    const stop = request();
    useLaserStore.setState(aborted(stop, { statusReport: null }), true);
    // Someone unlocked from the Console before the alarm had settled.
    useLaserStore.setState({ alarmCode: null, statusSequence: 11 });
    // Later a Frame is aborted: the same stream's stop request, a new ALARM:3.
    useLaserStore.setState({ alarmCode: 3, statusReport: ALARM_REPORT, statusSequence: 12 });
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 13 });
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 14 });
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
  });

  it('does not come back for an Abort a newer stream replaced', async () => {
    const stop = request();
    useLaserStore.setState(aborted(stop, { alarmCode: null, statusReport: null }), true);
    useLaserStore.setState({ streamerEpoch: 5 });
    useLaserStore.setState({ streamerEpoch: 4, alarmCode: 3, statusReport: ALARM_REPORT });
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 11 });
    useLaserStore.setState({ statusReport: { ...ALARM_REPORT }, statusSequence: 12 });
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
  });

  it('leaves an Abort that was already on screen when it was installed', async () => {
    uninstall();
    const stop = request();
    useLaserStore.setState(aborted(stop), true);
    uninstall = installAbortAutoRestore();
    useLaserStore.setState({ statusSequence: 11 });
    useLaserStore.setState({ statusSequence: 12 });
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
  });

  it('judges again before it commands: a change in the same turn keeps the card', async () => {
    const stop = request();
    useLaserStore.setState(aborted(stop), true);
    useLaserStore.setState({ statusSequence: 11 });
    // The verdict was reached; before the restore starts, an unlock lands.
    useLaserStore.setState({ positionEvidenceSuppressed: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(restoreOriginAfterAbort).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

describe('the Pause tooltip', () => {
  it('says how to stop without losing position, for a laser job with a realtime hold', () => {
    const title = pauseControlTitle('laser', true);
    expect(title).toBe(`${pauseControlMessage('laser', true)} ${PAUSE_THEN_ABORT_NOTE}`);
    expect(title).toContain('Use ABORT JOB or the physical E-stop if anything is unsafe.');
  });

  it('adds nothing where Pause only stops sending, or for a CNC job', () => {
    expect(pauseControlTitle('laser', false)).toBe(pauseControlMessage('laser', false));
    expect(pauseControlTitle('laser', false, true)).toBe(pauseControlMessage('laser', false, true));
    expect(pauseControlTitle('cnc', true, false, 'grbl-v1.1')).toBe(
      pauseControlMessage('cnc', true, false, 'grbl-v1.1'),
    );
  });
});

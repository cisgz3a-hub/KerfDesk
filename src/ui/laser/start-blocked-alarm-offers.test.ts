// Alarm fix offer for a blocked Frame (ADR-367). Frame job reaches it through
// frame-blocker-repair. These cases moved here with ADR-372 Amendment 1, when
// the blocked-Start dispatcher that used to route to it was removed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { STATUS_ALARM_START_MESSAGE } from './start-job-readiness';
import { ALARM_ACTIVE_START_MESSAGE, machineNotIdleStartMessage } from './start-machine-refusals';
import {
  offerAlarmFixForBlockedStart,
  POSITION_KEPT_UNLOCK_OFFER_PROMPT,
  PROBE_UNLOCK_OFFER_PROMPT,
  UNLOCK_OFFER_PROMPT,
  UNLOCKED_NEXT_STEP_MESSAGE,
} from './start-blocked-alarm-offers';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => true),
}));

const original = {
  unlockAlarm: useLaserStore.getState().unlockAlarm,
  home: useLaserStore.getState().home,
  capabilities: useLaserStore.getState().capabilities,
};

function idleStatus(): StatusReport {
  // Test-only shorthand: the offers read state alone from the report.
  return { state: 'Idle' } as StatusReport;
}

function softLimitRecord() {
  const connectionAttempt = useLaserStore.getState().connectionAttempt ?? 0;
  return { code: 2, connectionAttempt, duringHold: false };
}

/** A soft limit (ALARM:2) seen raised on this connection, position still shown. */
function softLimitAlarm() {
  return {
    alarmCode: 2,
    alarmRaised: softLimitRecord(),
    positionEvidenceSuppressed: false,
    resetRequired: false,
  };
}

beforeEach(() => {
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  useLaserStore.setState({
    unlockAlarm: vi.fn(async () => undefined),
    home: vi.fn(async () => undefined),
    statusReport: idleStatus(),
    alarmCode: null,
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
  useLaserStore.setState({
    ...original,
    statusReport: null,
    alarmCode: null,
    alarmRaised: null,
    positionEvidenceSuppressed: false,
  });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('alarm recovery offer', () => {
  it('unlocks a no-homing machine and hands the operator the Set origin step', async () => {
    useLaserStore.setState({ capabilities: { ...original.capabilities, unlock: true } });
    // Unlock voids the reported position until Set origin or Home, so the
    // Start cannot simply retry: the toast names the step that can.
    await expect(offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe(
      'handled',
    );
    expect(vi.mocked(useLaserStore.getState().unlockAlarm)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useLaserStore.getState().home)).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(UNLOCKED_NEXT_STEP_MESSAGE);
  });

  // Controller audit 2, M-1: a failed probe stops only the probe move, so the
  // Unlock after it keeps the position and origin (probe-failure-alarm.ts) and
  // the Frame can go on instead of asking for Set origin again.
  it('unlocks after a failed probe and retries the Frame once Idle', async () => {
    useLaserStore.setState({
      capabilities: { ...original.capabilities, unlock: true },
      alarmCode: 5,
      positionEvidenceSuppressed: false,
      unlockAlarm: vi.fn(async () => useLaserStore.setState({ alarmCode: null })),
    });
    await expect(offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe('retry');
    expect(jobAwareConfirm).toHaveBeenCalledWith(PROBE_UNLOCK_OFFER_PROMPT);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Alarm cleared.');
  });

  it('asks for Set origin after a failed probe when the position was already untrusted', async () => {
    useLaserStore.setState({
      capabilities: { ...original.capabilities, unlock: true },
      alarmCode: 5,
      positionEvidenceSuppressed: true,
    });
    await expect(offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe(
      'handled',
    );
    expect(jobAwareConfirm).toHaveBeenCalledWith(UNLOCK_OFFER_PROMPT);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(UNLOCKED_NEXT_STEP_MESSAGE);
  });

  // User annoyance audit A1, A3-P2-1 (ADR-367 Amendment 3): a soft limit is
  // raised after a controlled stop and keeps the machine position, so its
  // Unlock lets the Frame go on, with a prompt that says nothing about probes.
  it('unlocks after a soft limit and retries the Frame once Idle', async () => {
    useLaserStore.setState({
      capabilities: { ...original.capabilities, unlock: true },
      ...softLimitAlarm(),
      unlockAlarm: vi.fn(async () => useLaserStore.setState({ alarmCode: null })),
    });
    await expect(offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe('retry');
    expect(jobAwareConfirm).toHaveBeenCalledWith(POSITION_KEPT_UNLOCK_OFFER_PROMPT);
    expect(POSITION_KEPT_UNLOCK_OFFER_PROMPT).not.toMatch(/probe|touch plate/i);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Alarm cleared.');
  });

  // The Unlock decides at its reply: a restart in between hides the position.
  it('hands over to Set origin when the Unlock hid the position after all', async () => {
    useLaserStore.setState({
      capabilities: { ...original.capabilities, unlock: true },
      ...softLimitAlarm(),
      unlockAlarm: vi.fn(async () =>
        useLaserStore.setState({ alarmCode: null, positionEvidenceSuppressed: true }),
      ),
    });
    await expect(offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe(
      'handled',
    );
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(UNLOCKED_NEXT_STEP_MESSAGE);
  });

  it.each([
    ['an alarm that loses position', { alarmCode: 3 }],
    ['a soft limit followed by a restart KerfDesk did not send', { alarmRaised: null }],
    [
      'a soft limit raised during a hold',
      { alarmRaised: { ...softLimitRecord(), duringHold: true } },
    ],
    ['a position that was already untrusted', { positionEvidenceSuppressed: true }],
  ])('asks for Set origin after %s', async (_name, overrides) => {
    useLaserStore.setState({
      capabilities: { ...original.capabilities, unlock: true },
      ...softLimitAlarm(),
      ...overrides,
    });
    await expect(offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe(
      'handled',
    );
    expect(jobAwareConfirm).toHaveBeenCalledWith(UNLOCK_OFFER_PROMPT);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(UNLOCKED_NEXT_STEP_MESSAGE);
  });

  it('recognizes the two-message alarm refusal (alarm code + not Idle)', async () => {
    useLaserStore.setState({ capabilities: { ...original.capabilities, unlock: true } });
    await expect(
      offerAlarmFixForBlockedStart([
        ALARM_ACTIVE_START_MESSAGE,
        machineNotIdleStartMessage('Alarm'),
      ]),
    ).resolves.toBe('handled');
    expect(vi.mocked(useLaserStore.getState().unlockAlarm)).toHaveBeenCalledTimes(1);
  });

  it('homes instead of unlocking when the profile has homing switches', async () => {
    const project = createProject();
    useStore.setState({
      project: {
        ...project,
        device: { ...project.device, homing: { ...project.device.homing, enabled: true } },
      },
    });
    await expect(offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe('retry');
    expect(vi.mocked(useLaserStore.getState().home)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useLaserStore.getState().unlockAlarm)).not.toHaveBeenCalled();
  });

  // Controller audit 2026-09-25 CG-4: a halted Smoothieware board answers its
  // Home sequence's first line with `!!`, so the fix there is Unlock (M999).
  it('unlocks instead of homing on a controller that cannot home while halted', async () => {
    const project = createProject();
    useStore.setState({
      project: {
        ...project,
        device: { ...project.device, homing: { ...project.device.homing, enabled: true } },
      },
    });
    useLaserStore.setState({
      capabilities: { ...original.capabilities, unlock: true, homeFromAlarm: false },
    });
    await expect(offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe(
      'handled',
    );
    expect(vi.mocked(useLaserStore.getState().unlockAlarm)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useLaserStore.getState().home)).not.toHaveBeenCalled();
  });

  // Controller audit 2026-09-25 GP-2: after a critical event only a soft reset
  // is accepted, which the Alarm banner offers; Home and Unlock are not.
  it('offers nothing while the controller requires a soft reset', async () => {
    useLaserStore.setState({
      capabilities: { ...original.capabilities, unlock: true },
      resetRequired: true,
    });
    await expect(offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe(
      'unrepaired',
    );
    expect(jobAwareConfirm).not.toHaveBeenCalled();
    useLaserStore.setState({ resetRequired: false });
  });

  it('keeps the block when the operator declines the unlock', async () => {
    useLaserStore.setState({ capabilities: { ...original.capabilities, unlock: true } });
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    await expect(offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe(
      'unrepaired',
    );
    expect(vi.mocked(useLaserStore.getState().unlockAlarm)).not.toHaveBeenCalled();
  });

  it('offers nothing when the alarm arrives alongside unrelated blockers', async () => {
    await expect(
      offerAlarmFixForBlockedStart([
        STATUS_ALARM_START_MESSAGE,
        'A job is already active. Request ABORT or finish it before starting another.',
      ]),
    ).resolves.toBe('unrepaired');
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });
});

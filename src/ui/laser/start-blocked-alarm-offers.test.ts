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
  useLaserStore.setState({ ...original, statusReport: null, alarmCode: null });
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

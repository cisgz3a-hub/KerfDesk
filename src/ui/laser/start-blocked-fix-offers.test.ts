import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { cncOverrideStartIssue } from '../state/cnc-accessory-readiness';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE } from '../state/work-z-zero-evidence';
import { CNC_NO_WORK_ZERO_START_MESSAGE } from './cnc-start-advisories';
import { frameVerificationBlockedMessage } from './frame-verification-policy';
import { STATUS_ALARM_START_MESSAGE } from './start-job-readiness';
import { ALARM_ACTIVE_START_MESSAGE, machineNotIdleStartMessage } from './start-machine-refusals';
import { offerFixForBlockedStart } from './start-blocked-fix-offers';
import { runFrameNow } from './use-frame-action';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => true),
}));
vi.mock('./use-frame-action', () => ({
  runFrameNow: vi.fn(async () => true),
}));

const original = {
  zeroZHere: useLaserStore.getState().zeroZHere,
  confirmProbePlateRemoved: useLaserStore.getState().confirmProbePlateRemoved,
  unlockAlarm: useLaserStore.getState().unlockAlarm,
  home: useLaserStore.getState().home,
  sendRealtimeOverride: useLaserStore.getState().sendRealtimeOverride,
  capabilities: useLaserStore.getState().capabilities,
};

function idleStatus(): StatusReport {
  // Test-only shorthand: the offers read state alone from the report.
  return { state: 'Idle' } as StatusReport;
}

beforeEach(() => {
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  vi.mocked(runFrameNow).mockReset().mockResolvedValue(true);
  useLaserStore.setState({
    zeroZHere: vi.fn(async () => undefined),
    confirmProbePlateRemoved: vi.fn(),
    unlockAlarm: vi.fn(async () => undefined),
    home: vi.fn(async () => undefined),
    sendRealtimeOverride: vi.fn(async () => undefined),
    statusReport: idleStatus(),
    alarmCode: null,
    ovCache: null,
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
  useLaserStore.setState({ ...original, statusReport: null, alarmCode: null, ovCache: null });
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('offerFixForBlockedStart', () => {
  it('still delegates the missing-work-zero gate to the Zero Z offer', async () => {
    await expect(offerFixForBlockedStart([CNC_NO_WORK_ZERO_START_MESSAGE])).resolves.toBe('retry');
    expect(vi.mocked(useLaserStore.getState().zeroZHere)).toHaveBeenCalledTimes(1);
  });

  it('offers nothing when several blockers refuse together', async () => {
    await expect(
      offerFixForBlockedStart([
        PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE,
        'Controller is in alarm state.',
      ]),
    ).resolves.toBe('unrepaired');
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });

  it('confirms probe-plate removal in place and retries the Start', async () => {
    await expect(offerFixForBlockedStart([PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE])).resolves.toBe(
      'retry',
    );
    expect(vi.mocked(useLaserStore.getState().confirmProbePlateRemoved)).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'success' });
  });

  it('keeps the probe-plate block when the operator declines', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    await expect(offerFixForBlockedStart([PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE])).resolves.toBe(
      'unrepaired',
    );
    expect(vi.mocked(useLaserStore.getState().confirmProbePlateRemoved)).not.toHaveBeenCalled();
  });

  it('runs the Frame for a frame-required refusal without retrying the Start', async () => {
    await expect(offerFixForBlockedStart([frameVerificationBlockedMessage()])).resolves.toBe(
      'handled',
    );
    expect(runFrameNow).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'success',
      message: expect.stringContaining('press Start again'),
    });
  });

  it('keeps the frame block when the operator declines the trace', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    await expect(offerFixForBlockedStart([frameVerificationBlockedMessage()])).resolves.toBe(
      'unrepaired',
    );
    expect(runFrameNow).not.toHaveBeenCalled();
  });

  it('falls back to the plain refusal when the frame dispatch is refused', async () => {
    vi.mocked(runFrameNow).mockResolvedValue(false);
    await expect(offerFixForBlockedStart([frameVerificationBlockedMessage()])).resolves.toBe(
      'unrepaired',
    );
  });

  it('offers nothing for refusals without a one-click remedy', async () => {
    await expect(offerFixForBlockedStart(['A job is already active.'])).resolves.toBe('unrepaired');
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });
});

describe('alarm recovery offer', () => {
  it('unlocks a no-homing machine and retries once the controller settles', async () => {
    useLaserStore.setState({ capabilities: { ...original.capabilities, unlock: true } });
    await expect(offerFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe('retry');
    expect(vi.mocked(useLaserStore.getState().unlockAlarm)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useLaserStore.getState().home)).not.toHaveBeenCalled();
  });

  it('recognizes the two-message alarm refusal (alarm code + not Idle)', async () => {
    useLaserStore.setState({ capabilities: { ...original.capabilities, unlock: true } });
    await expect(
      offerFixForBlockedStart([ALARM_ACTIVE_START_MESSAGE, machineNotIdleStartMessage('Alarm')]),
    ).resolves.toBe('retry');
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
    await expect(offerFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe('retry');
    expect(vi.mocked(useLaserStore.getState().home)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useLaserStore.getState().unlockAlarm)).not.toHaveBeenCalled();
  });

  it('keeps the block when the operator declines the unlock', async () => {
    useLaserStore.setState({ capabilities: { ...original.capabilities, unlock: true } });
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    await expect(offerFixForBlockedStart([STATUS_ALARM_START_MESSAGE])).resolves.toBe('unrepaired');
    expect(vi.mocked(useLaserStore.getState().unlockAlarm)).not.toHaveBeenCalled();
  });

  it('offers nothing when the alarm arrives alongside unrelated blockers', async () => {
    await expect(
      offerFixForBlockedStart([STATUS_ALARM_START_MESSAGE, PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE]),
    ).resolves.toBe('unrepaired');
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });
});

describe('override reset offer', () => {
  const blockedOverrides = { feed: 120, rapid: 100, spindle: 100 };

  function overrideMessage(): string {
    const message = cncOverrideStartIssue('cnc', blockedOverrides);
    if (message === null) throw new Error('Expected an override refusal message.');
    return message;
  }

  it('resets all three overrides and retries once Ov: reports baseline', async () => {
    useLaserStore.setState({
      capabilities: { ...original.capabilities, overrides: true },
      ovCache: { feed: 100, rapid: 100, spindle: 100 },
    });
    await expect(offerFixForBlockedStart([overrideMessage()])).resolves.toBe('retry');
    expect(vi.mocked(useLaserStore.getState().sendRealtimeOverride)).toHaveBeenCalledTimes(3);
  });

  it('hands back without retry when the fresh Ov: report is still pending', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({
      capabilities: { ...original.capabilities, overrides: true },
      ovCache: blockedOverrides,
    });
    const offer = offerFixForBlockedStart([overrideMessage()]);
    await vi.advanceTimersByTimeAsync(4_500);
    await expect(offer).resolves.toBe('handled');
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      message: expect.stringContaining('press Start again'),
    });
  });

  it('offers nothing without realtime-override capability', async () => {
    useLaserStore.setState({ capabilities: { ...original.capabilities, overrides: false } });
    await expect(offerFixForBlockedStart([overrideMessage()])).resolves.toBe('unrepaired');
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });
});

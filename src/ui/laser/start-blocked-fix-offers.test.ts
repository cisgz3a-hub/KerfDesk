import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
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
  vi.mocked(runFrameNow).mockReset().mockResolvedValue(true);
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

// Frame-first (ADR-228): the gates whose offers died (Zero-Z, probe-plate,
// override reset) no longer block Start at all — their findings are Job
// Review warnings now. The offers that remain are alarm Unlock/Home, the
// Frame run, and the origin compile-input offers (tested beside their own
// module in start-blocked-setup-offers.test.ts).
describe('offerFixForBlockedStart', () => {
  it('offers nothing when several blockers refuse together', async () => {
    await expect(
      offerFixForBlockedStart([
        'A job is already active. Request ABORT or finish it before starting another.',
        'Auto-focus is running. Wait for it to finish before starting a job.',
      ]),
    ).resolves.toBe('unrepaired');
    expect(jobAwareConfirm).not.toHaveBeenCalled();
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
      offerFixForBlockedStart([
        STATUS_ALARM_START_MESSAGE,
        'A job is already active. Request ABORT or finish it before starting another.',
      ]),
    ).resolves.toBe('unrepaired');
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });
});

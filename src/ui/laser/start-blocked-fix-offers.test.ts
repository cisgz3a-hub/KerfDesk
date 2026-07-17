import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE } from '../state/work-z-zero-evidence';
import { CNC_NO_WORK_ZERO_START_MESSAGE } from './cnc-start-advisories';
import { frameVerificationBlockedMessage } from './frame-verification-policy';
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
};

beforeEach(() => {
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  vi.mocked(runFrameNow).mockReset().mockResolvedValue(true);
  useLaserStore.setState({
    zeroZHere: vi.fn(async () => undefined),
    confirmProbePlateRemoved: vi.fn(),
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  useLaserStore.setState({ ...original });
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
    await expect(offerFixForBlockedStart(['Controller is in alarm state.'])).resolves.toBe(
      'unrepaired',
    );
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });
});

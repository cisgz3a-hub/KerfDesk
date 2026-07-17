import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { CNC_NO_WORK_ZERO_START_MESSAGE } from './cnc-start-advisories';
import { PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE } from '../state/work-z-zero-evidence';
import { offerZeroZForBlockedStart } from './start-blocked-zero-z-offer';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => true),
}));

const originalZeroZHere = useLaserStore.getState().zeroZHere;

beforeEach(() => {
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  useLaserStore.setState({ zeroZHere: vi.fn(async () => undefined) });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  useLaserStore.setState({ zeroZHere: originalZeroZHere });
  vi.restoreAllMocks();
});

function zeroZSpy() {
  return vi.mocked(useLaserStore.getState().zeroZHere);
}

describe('offerZeroZForBlockedStart', () => {
  it('ignores refusals that are not the missing-work-zero gate', async () => {
    await expect(offerZeroZForBlockedStart(['Controller is in alarm state.'])).resolves.toBe(false);
    expect(jobAwareConfirm).not.toHaveBeenCalled();
    expect(zeroZSpy()).not.toHaveBeenCalled();
  });

  it('does not offer when other blockers would still refuse the Start', async () => {
    await expect(
      offerZeroZForBlockedStart([
        CNC_NO_WORK_ZERO_START_MESSAGE,
        PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE,
      ]),
    ).resolves.toBe(false);
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });

  it('keeps the job blocked when the operator declines', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    await expect(offerZeroZForBlockedStart([CNC_NO_WORK_ZERO_START_MESSAGE])).resolves.toBe(false);
    expect(zeroZSpy()).not.toHaveBeenCalled();
  });

  it('zeroes work Z and asks the caller to retry when the operator accepts', async () => {
    await expect(offerZeroZForBlockedStart([CNC_NO_WORK_ZERO_START_MESSAGE])).resolves.toBe(true);
    expect(zeroZSpy()).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'success',
      message: expect.stringContaining('Work Z zeroed'),
    });
  });

  it('reports a failed Zero Z and keeps the job blocked', async () => {
    useLaserStore.setState({
      zeroZHere: vi.fn(async () => Promise.reject(new Error('write rejected'))),
    });
    await expect(offerZeroZForBlockedStart([CNC_NO_WORK_ZERO_START_MESSAGE])).resolves.toBe(false);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'warning',
      message: expect.stringContaining('write rejected'),
    });
  });
});

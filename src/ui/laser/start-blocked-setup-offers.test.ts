import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  ABSOLUTE_CUSTOM_ORIGIN_ACTIVE_MESSAGE,
  USER_ORIGIN_REQUIRED_MESSAGE,
} from '../job-placement';
import { offerFixForBlockedStart } from './start-blocked-fix-offers';
import { offerSetupFixForBlockedStart } from './start-blocked-setup-offers';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareConfirm: vi.fn(() => true),
}));

const original = {
  setOriginHere: useLaserStore.getState().setOriginHere,
  resetOrigin: useLaserStore.getState().resetOrigin,
};

beforeEach(() => {
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
  useLaserStore.setState({
    setOriginHere: vi.fn(async () => undefined),
    resetOrigin: vi.fn(async () => undefined),
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  useLaserStore.setState({ ...original });
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('set-origin offer', () => {
  it('sets the work origin at the current position and retries', async () => {
    await expect(offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe('retry');
    expect(vi.mocked(useLaserStore.getState().setOriginHere)).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'success' });
  });

  it('reaches the offer through the blocked-Start dispatcher', async () => {
    await expect(offerFixForBlockedStart([USER_ORIGIN_REQUIRED_MESSAGE])).resolves.toBe('retry');
    expect(vi.mocked(useLaserStore.getState().setOriginHere)).toHaveBeenCalledTimes(1);
  });

  it('keeps the block when the operator declines', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    await expect(offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe(
      'unrepaired',
    );
    expect(vi.mocked(useLaserStore.getState().setOriginHere)).not.toHaveBeenCalled();
  });

  it('reports the failure and keeps the block when Set origin throws', async () => {
    useLaserStore.setState({
      setOriginHere: vi.fn(async () => {
        throw new Error('not idle');
      }),
    });
    await expect(offerSetupFixForBlockedStart(USER_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe(
      'unrepaired',
    );
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
  });
});

describe('reset-origin offer', () => {
  it('clears the custom origin and retries', async () => {
    await expect(offerSetupFixForBlockedStart(ABSOLUTE_CUSTOM_ORIGIN_ACTIVE_MESSAGE)).resolves.toBe(
      'retry',
    );
    expect(vi.mocked(useLaserStore.getState().resetOrigin)).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'success' });
  });

  it('keeps the block when the operator declines', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    await expect(offerSetupFixForBlockedStart(ABSOLUTE_CUSTOM_ORIGIN_ACTIVE_MESSAGE)).resolves.toBe(
      'unrepaired',
    );
    expect(vi.mocked(useLaserStore.getState().resetOrigin)).not.toHaveBeenCalled();
  });
});

describe('refusals without a one-click remedy', () => {
  it('offers nothing for an unknown refusal', async () => {
    await expect(offerSetupFixForBlockedStart('A job is already active.')).resolves.toBe(
      'unrepaired',
    );
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });

  it('offers nothing when several blockers refuse together', async () => {
    await expect(
      offerFixForBlockedStart([USER_ORIGIN_REQUIRED_MESSAGE, 'A job is already active.']),
    ).resolves.toBe('unrepaired');
    expect(jobAwareConfirm).not.toHaveBeenCalled();
  });
});

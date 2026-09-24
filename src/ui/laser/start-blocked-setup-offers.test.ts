import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE,
  USER_ORIGIN_REQUIRED_MESSAGE,
  VERIFIED_ORIGIN_REQUIRED_MESSAGE,
} from '../job-placement';
import { offerFixForBlockedStart } from './start-blocked-fix-offers';
import {
  offerSetupFixForBlockedStart,
  SET_ORIGIN_OFFER_PROMPT,
  VERIFIED_ORIGIN_SET_ORIGIN_OFFER_PROMPT,
} from './start-blocked-setup-offers';

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
    expect(jobAwareConfirm).toHaveBeenCalledWith(SET_ORIGIN_OFFER_PROMPT);
    expect(SET_ORIGIN_OFFER_PROMPT).toContain('Frame the updated placement before starting');
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

describe('unknown Absolute offset', () => {
  it('does not offer to erase an origin while waiting for controller coordinates', async () => {
    await expect(offerSetupFixForBlockedStart(ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE)).resolves.toBe(
      'unrepaired',
    );
    expect(jobAwareConfirm).not.toHaveBeenCalled();
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

describe('verified-origin set-origin offer (ADR-327)', () => {
  it('offers the same one-click Set origin remedy as User Origin', async () => {
    await expect(offerSetupFixForBlockedStart(VERIFIED_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe(
      'retry',
    );
    expect(jobAwareConfirm).toHaveBeenCalledWith(VERIFIED_ORIGIN_SET_ORIGIN_OFFER_PROMPT);
    expect(useLaserStore.getState().setOriginHere).toHaveBeenCalledTimes(1);
  });

  it('reaches the offer through the blocked-Start dispatcher', async () => {
    await expect(offerFixForBlockedStart([VERIFIED_ORIGIN_REQUIRED_MESSAGE])).resolves.toBe(
      'retry',
    );
  });

  it('keeps the block when the operator declines', async () => {
    vi.mocked(jobAwareConfirm).mockReturnValue(false);
    await expect(offerSetupFixForBlockedStart(VERIFIED_ORIGIN_REQUIRED_MESSAGE)).resolves.toBe(
      'unrepaired',
    );
    expect(useLaserStore.getState().setOriginHere).not.toHaveBeenCalled();
  });
});

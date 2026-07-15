import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { forgetControllerAndClearStartBlockers } from './LaserWindow';
import { useStartBlockerStore } from './start-blocker-store';

const originalForgetDevice = useLaserStore.getState().forgetDevice;
if (originalForgetDevice === undefined) throw new Error('Forget Controller action is unavailable.');

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
  useStartBlockerStore.setState({ messages: ['stale Start blocker'] });
});

afterEach(() => {
  useLaserStore.setState({ forgetDevice: originalForgetDevice });
  useToastStore.setState({ toasts: [] });
  useStartBlockerStore.getState().clear();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('LaserWindow Forget Controller action', () => {
  it('clears stale Start blockers and reports a rejected Forget action', async () => {
    useLaserStore.setState({
      forgetDevice: vi.fn(async () => {
        throw new Error('permission revocation failed');
      }),
    });

    await forgetControllerAndClearStartBlockers();

    expect(useStartBlockerStore.getState().messages).toEqual([]);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'error',
      message: expect.stringContaining('permission revocation failed'),
    });
  });
});

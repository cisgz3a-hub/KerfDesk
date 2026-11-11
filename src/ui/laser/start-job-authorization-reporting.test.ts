// Annoyance audit A1-P3-3: a refused Start was said twice, by the inline
// banner and by a native alert that had to be dismissed. It is now said as
// Frame says its refusals: the banner, plus one toast (ADR-707).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryRepository } from '../state/recovery';
import { useToastStore } from '../state/toast-store';
import { useStartBlockerStore } from './start-blocker-store';
import {
  reportRefusedStart,
  reportStartAuthorizationRefusal,
} from './start-job-authorization-reporting';

const repository = {} as RecoveryRepository;
const nativeAlert = vi.fn<(message?: string) => void>();

function toasts(): ReadonlyArray<{ readonly message: string; readonly variant: string }> {
  return useToastStore.getState().toasts.map(({ message, variant }) => ({ message, variant }));
}

beforeEach(() => {
  nativeAlert.mockClear();
  vi.spyOn(window, 'alert').mockImplementation(nativeAlert);
  useToastStore.setState({ toasts: [] });
  useStartBlockerStore.getState().clear();
});

afterEach(() => {
  useToastStore.setState({ toasts: [] });
  useStartBlockerStore.getState().clear();
  vi.restoreAllMocks();
});

describe('a refused Start', () => {
  it('keeps the reason in the banner and says it once in an error toast', async () => {
    await reportStartAuthorizationRefusal(
      { kind: 'blocked', message: 'The controller reports Alarm.' },
      null,
      repository,
    );

    expect(useStartBlockerStore.getState().messages).toEqual(['The controller reports Alarm.']);
    expect(useStartBlockerStore.getState().attempt).toBe('start');
    expect(toasts()).toEqual([
      { message: 'Cannot start job: The controller reports Alarm.', variant: 'error' },
    ]);
    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it('says changed job inputs the same way', async () => {
    await reportStartAuthorizationRefusal({ kind: 'execution-inputs-changed' }, null, repository);

    expect(useStartBlockerStore.getState().messages).toHaveLength(1);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]?.message).toMatch(/^Cannot start job: The current project/);
    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it('rewrites one toast when Start is refused again, instead of stacking', () => {
    reportRefusedStart('Could not start job', 'The port closed.');
    reportRefusedStart('Could not start job', 'The port is busy.');

    expect(toasts()).toEqual([
      { message: 'Could not start job: The port is busy.', variant: 'error' },
    ]);
    expect(useStartBlockerStore.getState().messages).toEqual(['The port is busy.']);
  });
});

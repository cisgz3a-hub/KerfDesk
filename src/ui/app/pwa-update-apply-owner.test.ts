import { describe, expect, it, vi } from 'vitest';
import { createRetryableUpdateApplyOwner } from './pwa-update-apply-owner';

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('createRetryableUpdateApplyOwner', () => {
  it('coalesces rapid and post-success clicks into one owned update attempt', async () => {
    const pending = deferred();
    const apply = vi.fn(() => pending.promise);
    const reportFailure = vi.fn();
    const requestApply = createRetryableUpdateApplyOwner(apply, reportFailure);

    const first = requestApply();
    const second = requestApply();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    pending.resolve();
    await first;
    expect(requestApply()).toBe(first);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it('reports one failed attempt and releases ownership for a retry', async () => {
    const firstAttempt = deferred();
    const apply = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstAttempt.promise)
      .mockResolvedValueOnce(undefined);
    const reportFailure = vi.fn();
    const requestApply = createRetryableUpdateApplyOwner(apply, reportFailure);

    const first = requestApply();
    expect(requestApply()).toBe(first);
    firstAttempt.reject(new Error('skip-waiting failed'));
    await first;

    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'skip-waiting failed' }),
    );
    const retry = requestApply();
    expect(retry).not.toBe(first);
    await retry;
    expect(apply).toHaveBeenCalledTimes(2);
  });
});

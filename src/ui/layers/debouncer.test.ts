import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncer } from './debouncer';

describe('createDebouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not commit before the debounce window elapses', () => {
    const commit = vi.fn<(n: number) => void>();
    const d = createDebouncer({ initial: 30, debounceMs: 300, commit });
    d.schedule(5);
    vi.advanceTimersByTime(299);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits exactly once after a burst of keystrokes', () => {
    const commit = vi.fn<(n: number) => void>();
    const d = createDebouncer({ initial: 30, debounceMs: 300, commit });
    d.schedule(5);
    vi.advanceTimersByTime(100);
    d.schedule(50);
    vi.advanceTimersByTime(100);
    d.schedule(500);
    vi.advanceTimersByTime(300);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(500);
  });

  it('flush commits synchronously and cancels the pending timer', () => {
    const commit = vi.fn<(n: number) => void>();
    const d = createDebouncer({ initial: 30, debounceMs: 300, commit });
    d.schedule(50);
    d.flush(99);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(99);
    vi.advanceTimersByTime(1000);
    expect(commit).toHaveBeenCalledTimes(1); // timer didn't refire
  });

  it('does not commit when the scheduled value equals the last committed', () => {
    const commit = vi.fn<(n: number) => void>();
    const d = createDebouncer({ initial: 30, debounceMs: 300, commit });
    d.schedule(30);
    vi.advanceTimersByTime(400);
    expect(commit).not.toHaveBeenCalled();
  });

  it('acknowledge updates the baseline so a matching schedule is a no-op', () => {
    const commit = vi.fn<(n: number) => void>();
    const d = createDebouncer({ initial: 30, debounceMs: 300, commit });
    d.acknowledge(75);
    d.schedule(75);
    vi.advanceTimersByTime(400);
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancel drops a pending commit', () => {
    const commit = vi.fn<(n: number) => void>();
    const d = createDebouncer({ initial: 30, debounceMs: 300, commit });
    d.schedule(50);
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();
  });
});

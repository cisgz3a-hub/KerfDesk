import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { useToastStore } from './toast-store';

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes a toast with default variant info', () => {
    useToastStore.getState().pushToast('hello');
    const [t] = useToastStore.getState().toasts;
    expect(t?.message).toBe('hello');
    expect(t?.variant).toBe('info');
  });

  it('pushes a toast with explicit variant', () => {
    useToastStore.getState().pushToast('boom', 'error');
    expect(useToastStore.getState().toasts[0]?.variant).toBe('error');
  });

  it('dismisses by id', () => {
    useToastStore.getState().pushToast('a');
    useToastStore.getState().pushToast('b');
    const [first] = useToastStore.getState().toasts;
    if (first === undefined) throw new Error('expected first toast');
    useToastStore.getState().dismissToast(first.id);
    const remaining = useToastStore.getState().toasts.map((t) => t.message);
    expect(remaining).toEqual(['b']);
  });

  it('auto-dismisses after the configured timeout', () => {
    useToastStore.getState().pushToast('temp');
    expect(useToastStore.getState().toasts.length).toBe(1);
    vi.advanceTimersByTime(3001);
    expect(useToastStore.getState().toasts.length).toBe(0);
  });

  it('two toasts dismiss independently', () => {
    useToastStore.getState().pushToast('first');
    vi.advanceTimersByTime(1000);
    useToastStore.getState().pushToast('second');
    vi.advanceTimersByTime(2001); // first hits 3001, second hits 2001
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['second']);
  });

  it('manual dismiss cancels the auto-dismiss timer (R-L1 regression)', () => {
    // The clearTimeout call inside dismissToast is the fix. We assert by
    // observing the timer count Vitest fake-timers tracks — clearTimeout
    // decrements it, while leaving the stale callback would not.
    useToastStore.getState().pushToast('cancel-me');
    expect(vi.getTimerCount()).toBe(1);
    const [t] = useToastStore.getState().toasts;
    if (t === undefined) throw new Error('expected toast');
    useToastStore.getState().dismissToast(t.id);
    expect(vi.getTimerCount()).toBe(0);
    // And advancing past the auto-dismiss window must not throw or change state.
    vi.advanceTimersByTime(5000);
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

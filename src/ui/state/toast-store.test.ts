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
});

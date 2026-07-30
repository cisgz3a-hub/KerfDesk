import { describe, expect, it, vi } from 'vitest';
import {
  createFrameScheduler,
  frameSchedulerHostFor,
  type FrameSchedulerHost,
} from './design-frame-scheduler';

// Controllable frame host: nothing runs until flush() is called.
function fakeHost(): FrameSchedulerHost & {
  readonly flush: () => void;
  readonly pending: () => number;
  readonly cancelled: () => ReadonlyArray<number>;
} {
  const queue = new Map<number, () => void>();
  const cancelled: number[] = [];
  let nextHandle = 1;
  return {
    requestFrame: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      queue.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      cancelled.push(handle);
      queue.delete(handle);
    },
    flush: () => {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback();
    },
    pending: () => queue.size,
    cancelled: () => cancelled,
  };
}

describe('createFrameScheduler', () => {
  it('runs once on the next frame', () => {
    const run = vi.fn();
    const host = fakeHost();
    const scheduler = createFrameScheduler(run, host);
    scheduler.request();
    expect(run).not.toHaveBeenCalled();
    host.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of requests into one run', () => {
    const run = vi.fn();
    const host = fakeHost();
    const scheduler = createFrameScheduler(run, host);
    for (let i = 0; i < 50; i += 1) scheduler.request();
    expect(host.pending()).toBe(1);
    host.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('can schedule again after a frame has run', () => {
    const run = vi.fn();
    const host = fakeHost();
    const scheduler = createFrameScheduler(run, host);
    scheduler.request();
    host.flush();
    scheduler.request();
    host.flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  // THE REGRESSION. Under React StrictMode an effect runs setup → cleanup →
  // setup. If cancel() leaves the handle set, the second setup's request() sees a
  // non-null handle, returns early, and NOTHING EVER PAINTS AGAIN. That shipped
  // once and was invisible to the whole test suite.
  it('still schedules after cancel — cancel must clear the handle', () => {
    const run = vi.fn();
    const host = fakeHost();
    const scheduler = createFrameScheduler(run, host);
    scheduler.request();
    scheduler.cancel();
    expect(host.cancelled()).toEqual([1]);
    scheduler.request();
    host.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('survives a StrictMode-shaped setup/cleanup/setup cycle', () => {
    const run = vi.fn();
    const host = fakeHost();
    // Each "mount" builds its own scheduler over the same host, as the hook does.
    const first = createFrameScheduler(run, host);
    first.request();
    first.cancel();
    const second = createFrameScheduler(run, host);
    second.request();
    host.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancel with nothing pending is inert', () => {
    const run = vi.fn();
    const host = fakeHost();
    const scheduler = createFrameScheduler(run, host);
    scheduler.cancel();
    expect(host.cancelled()).toEqual([]);
    scheduler.request();
    host.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('frameSchedulerHostFor', () => {
  it('uses the window scheduler when there is one', () => {
    const requestAnimationFrame = vi.fn(() => 42);
    const cancelAnimationFrame = vi.fn();
    const host = frameSchedulerHostFor({
      requestAnimationFrame,
      cancelAnimationFrame,
    } as unknown as Window);
    const handle = host.requestFrame(() => undefined);
    expect(handle).toBe(42);
    host.cancelFrame(handle);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
  });

  it('runs synchronously rather than never, when there is no window', () => {
    const run = vi.fn();
    const host = frameSchedulerHostFor(null);
    host.requestFrame(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs synchronously when the window has no requestAnimationFrame', () => {
    const run = vi.fn();
    const host = frameSchedulerHostFor({} as unknown as Window);
    host.requestFrame(run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

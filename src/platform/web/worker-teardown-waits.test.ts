// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { portStreamsReleased } from './worker-teardown-waits';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('port stream release polling', () => {
  it('returns immediately without scheduling a poll when both streams are free', async () => {
    vi.useFakeTimers();
    await portStreamsReleased({ readable: null, writable: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the first release check fast', async () => {
    vi.useFakeTimers();
    const readable = new ReadableStream<Uint8Array>();
    const reader = readable.getReader();
    const done = vi.fn();
    const release = portStreamsReleased({ readable, writable: null }).then(done);
    await vi.advanceTimersByTimeAsync(9);
    expect(done).not.toHaveBeenCalled();
    reader.releaseLock();
    await vi.advanceTimersByTimeAsync(1);
    await release;
    expect(done).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backs off a wedged port after the caller deadline but still waits for both actual locks', async () => {
    vi.useFakeTimers();
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const readable = new ReadableStream<Uint8Array>();
    const writable = new WritableStream<Uint8Array>();
    const reader = readable.getReader();
    const writer = writable.getWriter();
    const done = vi.fn();
    const release = portStreamsReleased({ readable, writable }).then(done);
    await vi.advanceTimersByTimeAsync(5_000);
    const afterDeadline = schedule.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(schedule.mock.calls.length - afterDeadline).toBeLessThanOrEqual(11);
    expect(done).not.toHaveBeenCalled();
    expect(readable.locked).toBe(true);
    expect(writable.locked).toBe(true);
    reader.releaseLock();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(done).not.toHaveBeenCalled();
    writer.releaseLock();
    await vi.advanceTimersByTimeAsync(1_000);
    await release;
    expect(done).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

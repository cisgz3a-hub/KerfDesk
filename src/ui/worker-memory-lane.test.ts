import { describe, expect, it, vi } from 'vitest';
import { WorkerMemoryLane } from './worker-memory-lane';

describe('worker memory lane', () => {
  it('grants immediately, then services existing waiters before reentrant reservations', () => {
    const lane = new WorkerMemoryLane();
    const order: string[] = [];
    const first = lane.reserve(() => order.push('preview'));
    expect(order).toEqual(['preview']);
    let releaseSave: (() => void) | undefined;
    lane.reserve((release) => {
      order.push('autosave');
      releaseSave = release;
      lane.reserve((done) => {
        order.push('later-preview');
        done();
      });
    });
    lane.reserve((release) => {
      order.push('already-queued');
      release();
    });
    first();
    expect(order).toEqual(['preview', 'autosave']);
    releaseSave?.();
    expect(order).toEqual(['preview', 'autosave', 'already-queued', 'later-preview']);
  });

  it('cancels queued work without releasing another owner and ignores stale tokens', () => {
    const lane = new WorkerMemoryLane();
    const first = lane.reserve(() => undefined);
    const cancelled = vi.fn();
    const cancel = lane.reserve(cancelled);
    const last = vi.fn();
    lane.reserve(last);
    cancel();
    cancel();
    expect(last).not.toHaveBeenCalled();
    first();
    expect(cancelled).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledOnce();
    const next = vi.fn();
    lane.reserve(next);
    first();
    cancel();
    expect(next).not.toHaveBeenCalled();
    last.mock.calls[0]?.[0]();
    expect(next).toHaveBeenCalledOnce();
  });

  it('handles synchronous release before reserve returns and remains exclusive', () => {
    const lane = new WorkerMemoryLane();
    let depth = 0;
    let maximumDepth = 0;
    const first = lane.reserve((release) => {
      depth++;
      maximumDepth = Math.max(maximumDepth, depth);
      lane.reserve((done) => {
        depth++;
        maximumDepth = Math.max(maximumDepth, depth);
        depth--;
        done();
      });
      release();
      depth--;
    });
    expect(maximumDepth).toBe(1);
    const current = lane.reserve(() => undefined);
    const waiting = vi.fn();
    lane.reserve(waiting);
    first();
    expect(waiting).not.toHaveBeenCalled();
    current();
    expect(waiting).toHaveBeenCalledOnce();
  });

  it('does not strand the lane when a start callback throws', () => {
    const lane = new WorkerMemoryLane();
    const waiting = vi.fn();
    expect(() =>
      lane.reserve(() => {
        lane.reserve(waiting);
        throw new Error('startup failed');
      }),
    ).toThrow('startup failed');
    expect(waiting).toHaveBeenCalledOnce();
    waiting.mock.calls[0]?.[0]();
    expect(() => lane.reserve((release) => release())).not.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { advanceStream } from './laser-stream-ack';

afterEach(() => {
  vi.useRealTimers();
});

describe('advanceStream MPG completion ownership', () => {
  it('starts post-job settlement when the final ack arrives during MPG takeover', () => {
    vi.useFakeTimers();
    const { refs, set, get } = makeLineHandlerHarness();
    set({ streamer: step(createStreamer('M5\n')).state, mpgActive: true });
    const safeWrite = vi.fn(() => new Promise<void>(() => undefined));

    advanceStream(set, get, refs, safeWrite, 'ok');

    expect(get().streamer?.status).toBe('done');
    expect(get().controllerOperation).toMatchObject({ kind: 'post-job-settle', phase: 'dwell' });
    expect(safeWrite).toHaveBeenCalledTimes(1);
  });
});

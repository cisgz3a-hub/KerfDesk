import { describe, expect, it } from 'vitest';
import { createStreamer, onAck, parseStatusReport, step } from '../../core/controllers/grbl';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { handleStatusLine } from './laser-status-line';

describe('laser status-line ownership transitions', () => {
  it('releases a completed stream when Idle and MPG takeover arrive together', () => {
    const { refs, set, get } = makeLineHandlerHarness();
    const started = step(createStreamer('M5\n')).state;
    const done = onAck(started, 'ok').state;
    const report = parseStatusReport('<Idle|MPos:1.000,0.000,0.000|FS:0,0|MPG:1>');
    if (report === null) throw new Error('test status report did not parse');
    expect(done.status).toBe('done');
    set({ streamer: done, mpgActive: null });

    handleStatusLine(set, get, refs, async () => undefined, report);

    expect(get().streamer).toBeNull();
    expect(get().lastWriteError).toBeNull();
  });

  it('keeps a completed stream terminal when MPG takeover arrives before controller Idle', () => {
    const { refs, set, get } = makeLineHandlerHarness();
    const done = onAck(step(createStreamer('M5\n')).state, 'ok').state;
    const running = parseStatusReport('<Run|MPos:1.000,0.000,0.000|FS:100,0|MPG:1>');
    const idle = parseStatusReport('<Idle|MPos:1.000,0.000,0.000|FS:0,0|MPG:1>');
    if (running === null || idle === null) throw new Error('test status report did not parse');
    set({ streamer: done, mpgActive: null });

    handleStatusLine(set, get, refs, async () => undefined, running);
    expect(get().streamer?.status).toBe('done');
    expect(get().lastWriteError).toBeNull();

    handleStatusLine(set, get, refs, async () => undefined, idle);
    expect(get().streamer).toBeNull();
  });
});

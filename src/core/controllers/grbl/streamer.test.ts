import { describe, expect, it } from 'vitest';
import {
  cancel,
  createStreamer,
  DEFAULT_RX_BUFFER_BYTES,
  disconnect,
  markErrored,
  nextQueuedLine,
  onAck,
  pause,
  progress,
  queuedLineCount,
  remainingQueuedLines,
  resume,
  step,
  wipeInFlight,
} from './streamer';

describe('createStreamer', () => {
  it('strips blank lines and comments, terminates each line with \\n', () => {
    const s = createStreamer('G21\n; comment\n\nG90\nM5\n');
    expect(s.total).toBe(3);
    expect(s.queued).toEqual(['G21\n', 'G90\n', 'M5\n']);
    expect(s.queueIndex).toBe(0);
  });

  it('returns done state for empty input', () => {
    const s = createStreamer('');
    expect(s.status).toBe('done');
    expect(s.total).toBe(0);
  });

  it('uses the default 127-byte buffer unless overridden', () => {
    expect(createStreamer('G21').rxBufferBytes).toBe(DEFAULT_RX_BUFFER_BYTES);
    expect(createStreamer('G21', { rxBufferBytes: 64 }).rxBufferBytes).toBe(64);
  });

  it('can be configured for ping-pong streaming', () => {
    const s = createStreamer('G21\nG90\nM5', { streamingMode: 'ping-pong' });
    expect(s.streamingMode).toBe('ping-pong');
  });
});

describe('step — buffer filling', () => {
  it('sends as many lines as fit in the rx buffer', () => {
    const s = createStreamer(['G21', 'G90', 'M5'].join('\n'));
    const r = step(s);
    expect(r.toSend).toBe('G21\nG90\nM5\n');
    expect(r.state.inFlight.map((f) => f.line)).toEqual(['G21\n', 'G90\n', 'M5\n']);
    expect(queuedLineCount(r.state)).toBe(0);
    expect(r.state.status).toBe('streaming');
  });

  it('stops at the buffer boundary', () => {
    // Each line is 10 bytes (9 chars + \n). Buffer 25 → 2 lines fit (20),
    // third line would overflow (30).
    const s = createStreamer(['LINE1ABCD', 'LINE2ABCD', 'LINE3ABCD'].join('\n'), {
      rxBufferBytes: 25,
    });
    const r = step(s);
    expect(r.state.inFlight).toHaveLength(2);
    expect(queuedLineCount(r.state)).toBe(1);
  });

  it('sends exactly one queued line per step in ping-pong mode', () => {
    const first = step(createStreamer('G21\nG90\nM5', { streamingMode: 'ping-pong' }));
    expect(first.toSend).toBe('G21\n');
    expect(first.state.inFlight.map((item) => item.line)).toEqual(['G21\n']);
    expect(remainingQueuedLines(first.state)).toEqual(['G90\n', 'M5\n']);

    const acked = onAck(first.state, 'ok').state;
    const second = step(acked);

    expect(second.toSend).toBe('G90\n');
    expect(second.state.inFlight.map((item) => item.line)).toEqual(['G90\n']);
    expect(remainingQueuedLines(second.state)).toEqual(['M5\n']);
  });

  it('returns toSend="" when paused', () => {
    const s = pause(createStreamer('G21\nG90'));
    const r = step(s);
    expect(r.toSend).toBe('');
    expect(r.state.status).toBe('paused');
  });
});

describe('onAck — consuming acks', () => {
  it('pops the head of in-flight on ok', () => {
    const s = step(createStreamer('G21\nG90\nM5')).state;
    const r = onAck(s, 'ok');
    expect(r.acked).toBe('G21\n');
    expect(r.state.inFlight).toHaveLength(2);
    expect(r.state.completed).toBe(1);
  });

  it('makes an error ack terminal (errored) and refuses to send more (P0-1)', () => {
    const s = step(createStreamer('G21\nG90')).state;
    const r = onAck(s, 'error');
    // The rejected line is still consumed for buffer accounting (GRBL freed its
    // bytes when it replied error:N)...
    expect(r.acked).toBe('G21\n');
    expect(r.state.inFlight).toHaveLength(1);
    // ...but the stream is now terminal: status 'errored', and step() sends
    // nothing further, so a laser-on line cannot fire after the rejected move.
    expect(r.state.status).toBe('errored');
    expect(step(r.state).toSend).toBe('');
  });

  it('does not send the next queued line after an error (no laser-on after reject, P0-1)', () => {
    // Tiny buffer so lines stay queued after the first send. This is the exact
    // path that sent M3 S255 right after a rejected G21 before the fix.
    const s = step(createStreamer('G21\nG90\nM3 S255\nG1 X10', { rxBufferBytes: 12 })).state;
    expect(queuedLineCount(s)).toBeGreaterThan(0);
    const r = onAck(s, 'error');
    expect(r.state.status).toBe('errored');
    expect(step(r.state).toSend).toBe('');
  });

  it('cancels the stream on alarm', () => {
    const s = step(createStreamer('G21\nG90')).state;
    const r = onAck(s, 'alarm');
    expect(r.state.status).toBe('cancelled');
  });

  it('returns acked=null if an ack arrives with empty in-flight', () => {
    const s = createStreamer('G21');
    expect(onAck(s, 'ok').acked).toBeNull();
  });

  // GRBL keeps acking held-but-parsed lines during a feed hold, so a paused
  // stream routinely drains its in-flight tail while lines remain queued. An
  // ALARM arriving then (limit trip, external reset) is not a line ack — but
  // it must still make the stream terminal, or resume() stays available and
  // streams the queue into a locked controller.
  it('cancels a paused stream on alarm even with nothing in flight', () => {
    const first = step(
      createStreamer('G1 X1234567890\nG1 X1234567891\nG1 X1234567892\n', { rxBufferBytes: 30 }),
    );
    let state = pause(first.state);
    state = onAck(state, 'ok').state;
    state = onAck(state, 'ok').state;
    expect(state.inFlight).toEqual([]);
    expect(queuedLineCount(state)).toBeGreaterThan(0);
    expect(state.status).toBe('paused');

    const alarmed = onAck(state, 'alarm');

    expect(alarmed.acked).toBeNull();
    expect(alarmed.state.status).toBe('cancelled');
    expect(alarmed.state.queued).toEqual([]);
    expect(step(alarmed.state).toSend).toBe('');
  });

  it('marks a drained streaming state errored on an error ack with nothing in flight', () => {
    const first = step(
      createStreamer('G1 X1234567890\nG1 X1234567891\nG1 X1234567892\n', { rxBufferBytes: 30 }),
    );
    let state = pause(first.state);
    state = onAck(state, 'ok').state;
    state = onAck(state, 'ok').state;
    state = { ...state, status: 'streaming' };

    const errored = onAck(state, 'error');

    expect(errored.state.status).toBe('errored');
    expect(errored.state.queued).toEqual([]);
  });

  it('transitions to done when last line is acked', () => {
    let state = step(createStreamer('G21\nG90')).state;
    state = onAck(state, 'ok').state;
    state = onAck(state, 'ok').state;
    expect(state.status).toBe('done');
  });

  // GRBL acks held-but-parsed lines during a feed hold, so pausing near the
  // end of a job routinely drains the queues while the machine still holds
  // unexecuted planner motion. Promoting to 'done' there unmounts Resume and
  // reports completion for a job whose tail was never cut.
  it('stays paused while the held tail acks out (no done promotion during hold)', () => {
    let state = pause(step(createStreamer('G21\nG90')).state);
    state = onAck(state, 'ok').state;
    state = onAck(state, 'ok').state;
    expect(state.inFlight).toEqual([]);
    expect(queuedLineCount(state)).toBe(0);
    expect(state.status).toBe('paused');
  });

  it('resume of a fully-drained paused stream completes to done', () => {
    let state = pause(step(createStreamer('G21\nG90')).state);
    state = onAck(state, 'ok').state;
    state = onAck(state, 'ok').state;

    const resumed = resume(state);

    expect(resumed.status).toBe('done');
    expect(step(resumed).toSend).toBe('');
  });

  it('keeps errored terminal when trailing oks drain the in-flight tail (H5)', () => {
    // All three lines fit in flight at once — the final RX window. G21 is
    // rejected; the trailing oks for G90/M5 must not promote the stream back
    // to 'done', or the UI reports a clean finish over a real rejection.
    let state = step(createStreamer('G21\nG90\nM5')).state;
    state = onAck(state, 'error').state;
    expect(state.status).toBe('errored');
    state = onAck(state, 'ok').state;
    state = onAck(state, 'ok').state;
    expect(state.inFlight).toHaveLength(0);
    expect(queuedLineCount(state)).toBe(0);
    expect(state.status).toBe('errored');
  });

  it('keeps cancelled terminal when trailing oks drain the in-flight tail', () => {
    let state = step(createStreamer('G21\nG90\nM5')).state;
    state = onAck(state, 'alarm').state;
    state = onAck(state, 'ok').state;
    state = onAck(state, 'ok').state;
    expect(state.status).toBe('cancelled');
  });

  // Audit F1: ALARM:N means the firmware discarded its RX buffer and planner.
  // The remaining in-flight lines will never be acked — leaving them in the
  // accounting makes the store-side ack-attribution layer claim future
  // untracked acks ($X, M9 cleanup) for the stream forever.
  it('an alarm ack wipes ALL in-flight accounting, not just the head line', () => {
    const s = step(createStreamer('G21\nG90\nM5')).state;
    expect(s.inFlight).toHaveLength(3);
    const r = onAck(s, 'alarm');
    expect(r.state.status).toBe('cancelled');
    expect(r.state.inFlight).toEqual([]);
    expect(r.state.inFlightBytes).toBe(0);
    expect(r.state.completed).toBe(1);
  });

  it('wipeInFlight clears in-flight accounting without changing status', () => {
    const s = step(createStreamer('G21\nG90')).state;
    const wiped = wipeInFlight(cancel(s));
    expect(wiped.status).toBe('cancelled');
    expect(wiped.inFlight).toEqual([]);
    expect(wiped.inFlightBytes).toBe(0);
    const erroredWipe = wipeInFlight(markErrored(s));
    expect(erroredWipe.status).toBe('errored');
    expect(erroredWipe.inFlight).toEqual([]);
  });

  it('markErrored is terminal, clears the queue, and keeps step() silent', () => {
    const s = step(createStreamer('G21\nG90\nM3 S255\nG1 X10', { rxBufferBytes: 12 })).state;
    const r = markErrored(s);
    expect(r.status).toBe('errored');
    expect(r.queued).toHaveLength(0);
    expect(step(r).toSend).toBe('');
  });

  it('advances through a long queue without copying its backing array', () => {
    let state = createStreamer(
      Array.from({ length: 2_000 }, (_unused, index) => `G1 X${index}`).join('\n'),
      { streamingMode: 'ping-pong' },
    );
    const backingQueue = state.queued;

    for (let index = 0; index < 1_000; index += 1) {
      state = step(state).state;
      expect(nextQueuedLine(state)).toBe(`G1 X${index + 1}\n`);
      expect(state.queued).toBe(backingQueue);
      state = onAck(state, 'ok').state;
    }

    expect(state.queueIndex).toBe(1_000);
    expect(queuedLineCount(state)).toBe(1_000);
  });
});

describe('pause / resume / cancel', () => {
  it('pause halts further sends until resume', () => {
    let s = createStreamer(['G21', 'G90', 'M5', 'M2'].join('\n'), { rxBufferBytes: 8 });
    s = step(s).state; // fills as much as fits
    s = pause(s);
    expect(step(s).toSend).toBe('');
    s = resume(s);
    // Acks free buffer; subsequent step sends more
    s = onAck(s, 'ok').state;
    expect(step(s).toSend.length).toBeGreaterThan(0);
  });

  it('pauses an acknowledged tail that is still executing and returns to done on resume', () => {
    let state = step(createStreamer('G1 X1\nG1 X2')).state;
    state = onAck(state, 'ok').state;
    state = onAck(state, 'ok').state;
    expect(state.status).toBe('done');

    const paused = pause(state);

    expect(paused.status).toBe('paused');
    expect(resume(paused).status).toBe('done');
  });

  it('cancel empties the queue and sets status', () => {
    const s = cancel(createStreamer('G21\nG90'));
    expect(s.queued).toHaveLength(0);
    expect(s.status).toBe('cancelled');
  });
});

describe('progress', () => {
  it('reports completed / total', () => {
    let s = createStreamer('G21\nG90\nM5');
    expect(progress(s)).toBe(0);
    s = step(s).state;
    s = onAck(s, 'ok').state;
    expect(progress(s)).toBeCloseTo(1 / 3);
    s = onAck(s, 'ok').state;
    s = onAck(s, 'ok').state;
    expect(progress(s)).toBe(1);
  });

  it('reports 1 for an empty job', () => {
    expect(progress(createStreamer(''))).toBe(1);
  });
});

describe('disconnect', () => {
  it('marks the streamer disconnected and clears the queue (terminal state)', () => {
    let s = createStreamer('G21\nG90\nM5\n');
    s = step(s).state; // status -> streaming, all lines now in flight
    expect(s.status).toBe('streaming');
    const d = disconnect(s);
    expect(d.status).toBe('disconnected');
    // Queue cleared so a subsequent step() can't push any more bytes
    // even if something tried to re-engage the streamer.
    expect(d.queued).toEqual([]);
    // step() is a no-op once disconnected — matches done/cancelled paths.
    expect(step(d).toSend).toBe('');
  });

  it('is distinct from cancel — status differs even though queue handling is the same', () => {
    let s = createStreamer('G21\n');
    s = step(s).state;
    expect(disconnect(s).status).toBe('disconnected');
    expect(cancel(s).status).toBe('cancelled');
  });
});

// M13 (AUDIT-2026-06-10): a single line longer than the RX buffer can never
// satisfy the send condition - step() breaks with nothing sent, no error,
// no state change, leaving a phantom idle job and a frozen progress bar.
describe('findOversizedLine (M13)', () => {
  it('reports the first line that can never fit the RX buffer', async () => {
    const { findOversizedLine } = await import('./streamer');
    const oversized = `G1 X${'9'.repeat(130)}`;
    const found = findOversizedLine(`G0 X0\n${oversized}\nG1 X1`);
    expect(found).not.toBeNull();
    expect(found?.lineNumber).toBe(2);
    expect(found?.bytes).toBeGreaterThan(found?.limit ?? Infinity - 1);
  });

  it('returns null for normal G-code', async () => {
    const { findOversizedLine } = await import('./streamer');
    expect(findOversizedLine('G21\nG90\nG1 X100.000 Y200.000 S1000 F1500')).toBeNull();
  });
});

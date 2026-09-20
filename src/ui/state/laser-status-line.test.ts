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

describe('laser status-line receive-capacity evidence (ADR-331)', () => {
  it('latches a quiescent Bf report and ignores one taken with lines in flight', () => {
    const { refs, set, get } = makeLineHandlerHarness();
    const stock = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|Bf:15,128|FS:0,0>');
    // Deliberately LARGER than the latched reading, so only the in-flight
    // guard can keep it out — the max-latch would accept it.
    const inFlight = parseStatusReport(
      '<Run|MPos:1.000,0.000,0.000,0.000|Bf:504,65535|FS:3000,800>',
    );
    if (stock === null || inFlight === null) throw new Error('test status report did not parse');
    set({ streamer: null, pendingUntrackedAcks: 0, rxCapacityEvidence: null });

    handleStatusLine(set, get, refs, async () => undefined, stock);
    expect(get().rxCapacityEvidence).toMatchObject({
      rxBytesFree: 128,
      plannerBlocksFree: 15,
      sessionEpoch: get().controllerSessionEpoch,
    });

    set({ streamer: step(createStreamer('G1 X1\nG1 X2\n')).state });
    handleStatusLine(set, get, refs, async () => undefined, inFlight);
    expect(get().rxCapacityEvidence?.rxBytesFree).toBe(128);

    // An owed command acknowledgement holds the ring too, even with no stream.
    set({ streamer: null, pendingUntrackedAcks: 1 });
    handleStatusLine(set, get, refs, async () => undefined, inFlight);
    expect(get().rxCapacityEvidence?.rxBytesFree).toBe(128);

    // Quiescent again: the larger reading is accepted.
    set({ pendingUntrackedAcks: 0 });
    handleStatusLine(set, get, refs, async () => undefined, inFlight);
    expect(get().rxCapacityEvidence?.rxBytesFree).toBe(65535);
  });
});

describe('laser status-line controller-owned hold record (ADR-333)', () => {
  function report(line: string) {
    const parsed = parseStatusReport(line);
    if (parsed === null) throw new Error(`test status report did not parse: ${line}`);
    return parsed;
  }

  it('logs the transition once while a job is streaming, not every report', () => {
    const { refs, set, get } = makeLineHandlerHarness();
    const held = report('<Hold:0|MPos:1.000,0.000,0.000|FS:0,0>');
    set({ streamer: step(createStreamer('G1 X1\nG1 X2\n')).state, log: [] });

    handleStatusLine(set, get, refs, async () => undefined, held);
    const afterFirst = get().log.filter((line) => line.includes('entered Hold'));
    handleStatusLine(set, get, refs, async () => undefined, held);

    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toContain('did not request this pause');
    expect(get().log.filter((line) => line.includes('entered Hold'))).toHaveLength(1);
  });

  it('logs a door hold and stays silent with no job running', () => {
    const { refs, set, get } = makeLineHandlerHarness();
    set({ streamer: step(createStreamer('G1 X1\nG1 X2\n')).state, log: [] });

    handleStatusLine(set, get, refs, async () => undefined, report('<Door:1|MPos:1,0,0|FS:0,0>'));
    expect(get().log.some((line) => line.includes('entered Door'))).toBe(true);

    set({ streamer: null, statusReport: null, log: [] });
    handleStatusLine(set, get, refs, async () => undefined, report('<Hold:0|MPos:1,0,0|FS:0,0>'));
    expect(get().log.some((line) => line.includes('entered Hold'))).toBe(false);
  });
});

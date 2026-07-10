// CNC-01 — sender-side M0 tool-change pause. The streamer swallows a lone M0
// (never sends it) and holds at 'tool-change' so GRBL drains to Idle, where
// jog/probe/G92 to re-zero the new bit are legal. continueToolChange() drops
// the M0 and resumes from the emitter's own M3/G4 spin-up.
import { describe, expect, it } from 'vitest';
import { continueToolChange, createStreamer, onAck, step } from './streamer';

// A two-section multi-tool program: cut, retract/off/park, M0, spin-up, cut.
const MULTI_TOOL = [
  'G1 X10 Y10 F800', // section 1 cut
  'G0 Z5', // retract
  'M5', // spindle off
  'G0 X0 Y0', // park
  'M0', // tool change boundary
  'M3 S12000', // spin up (after M0)
  'G4 P3.000',
  'G0 Z5',
  'G1 X20 Y20 F800', // section 2 cut
].join('\n');

describe('streamer tool-change pause (CNC-01)', () => {
  it('sends everything up to the M0 but not the M0, and holds at tool-change', () => {
    const s = createStreamer(MULTI_TOOL, { toolChangePause: true });
    const r = step(s);
    expect(r.state.status).toBe('tool-change');
    expect(r.toSend).toContain('G0 X0 Y0'); // pre-M0 lines flushed
    expect(r.toSend).not.toContain('M0'); // M0 never sent
    expect(r.state.queued[0]).toBe('M0\n'); // left at queue head
  });

  it('step() sends nothing while held at a tool change (non-sending, non-terminal)', () => {
    const held = step(createStreamer(MULTI_TOOL, { toolChangePause: true })).state;
    const again = step(held);
    expect(again.toSend).toBe('');
    expect(again.state.status).toBe('tool-change');
  });

  it('continueToolChange drops the M0, counts it, and resumes from the spin-up', () => {
    const held = step(createStreamer(MULTI_TOOL, { toolChangePause: true })).state;
    const completedBefore = held.completed;
    const resumed = continueToolChange(held);
    expect(resumed.status).toBe('streaming');
    expect(resumed.queued[0]).toBe('M3 S12000\n'); // M0 dropped, spin-up next
    expect(resumed.completed).toBe(completedBefore + 1); // M0 counted so completed/total stays exact
    // ...and step() now sends the remaining section from the spin-up onward.
    expect(step(resumed).toSend).toContain('M3 S12000');
  });

  it('stops even when the M0 is the first line of the batch (char-counted trap)', () => {
    // retract/M5/park/M0 are all tiny and would batch into one chunk; the
    // in-loop check must break before the M0 rather than at the top only.
    const s = createStreamer('M0\nM3 S12000\nG1 X1 Y1', { toolChangePause: true });
    const r = step(s);
    expect(r.state.status).toBe('tool-change');
    expect(r.toSend).toBe(''); // nothing sent — M0 was first
    expect(r.state.queued[0]).toBe('M0\n');
  });

  it('an ack draining the pre-M0 tail does NOT promote tool-change to done', () => {
    let state = step(createStreamer(MULTI_TOOL, { toolChangePause: true })).state;
    // drain every in-flight (pre-M0) line
    while (state.inFlight.length > 0) {
      state = onAck(state, 'ok').state;
    }
    expect(state.status).toBe('tool-change'); // still held; M0 still queued
  });

  it('does NOT swallow M0 when toolChangePause is off (imported .nc / laser)', () => {
    const r = step(createStreamer('G1 X1 Y1\nM0\nG1 X2 Y2', { toolChangePause: false }));
    expect(r.state.status).toBe('streaming');
    expect(r.toSend).toContain('M0'); // ordinary program stop, sent through
  });

  it('continueToolChange is a no-op when not held at a tool change', () => {
    const streaming = step(createStreamer(MULTI_TOOL, { toolChangePause: true })).state;
    // already covered above; here assert the guard on a plain streaming state
    const plain = step(createStreamer('G1 X1 Y1', { toolChangePause: true })).state;
    expect(plain.status).toBe('streaming');
    expect(continueToolChange(plain)).toBe(plain);
    expect(streaming.status).toBe('tool-change');
  });
});

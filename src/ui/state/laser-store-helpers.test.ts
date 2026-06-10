import { describe, expect, it } from 'vitest';
import { createStreamer, step, type StatusReport } from '../../core/controllers/grbl';
import {
  detectStreamStall,
  STREAM_STALL_TIMEOUT_MS,
  type StallProbe,
} from './laser-store-helpers';

function streamingState() {
  return step(createStreamer('G1 X1 S100\nG1 X2\nG1 X3')).state;
}

function report(state: StatusReport['state']): StatusReport {
  return {
    state,
    subState: null,
    mPos: null,
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}

// M13 (AUDIT-2026-06-10): if GRBL stops acking mid-job there was no watchdog
// anywhere — 'streaming' at a frozen percentage indefinitely, silently.
describe('detectStreamStall (M13)', () => {
  it('flags a stall when no ack arrives within the timeout', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, report('Run'), null, 1_000);
    expect(first.stalled).toBe(false);

    const second = detectStreamStall(
      streamer,
      report('Run'),
      first.probe,
      1_000 + STREAM_STALL_TIMEOUT_MS,
    );
    expect(second.stalled).toBe(true);
  });

  it('resets the clock when the stream makes progress', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, report('Run'), null, 1_000);
    // An ack arrived: completed advanced.
    const progressed = { ...streamer, completed: streamer.completed + 1 };
    const second = detectStreamStall(
      progressed,
      report('Run'),
      first.probe,
      1_000 + STREAM_STALL_TIMEOUT_MS,
    );
    expect(second.stalled).toBe(false);
  });

  it('does not flag a stall during a feed hold or door state', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, report('Run'), null, 1_000);
    const held = detectStreamStall(
      streamer,
      report('Hold'),
      first.probe,
      1_000 + STREAM_STALL_TIMEOUT_MS * 2,
    );
    expect(held.stalled).toBe(false);
  });

  it('is inert when no job is streaming', () => {
    const probe: StallProbe = null;
    expect(detectStreamStall(null, report('Idle'), probe, 5_000).stalled).toBe(false);
  });
});

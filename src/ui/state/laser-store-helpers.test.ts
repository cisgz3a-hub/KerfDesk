import { describe, expect, it } from 'vitest';
import { createStreamer, step, type StatusReport } from '../../core/controllers/grbl';
import {
  detectStreamStall,
  STREAM_STALL_RUNNING_TIMEOUT_MS,
  STREAM_STALL_TIMEOUT_MS,
  type StallProbe,
} from './laser-store-helpers';
import { HOST_SCHEDULING_GAP_MS } from './laser-stream-heartbeat';

const POLL_MS = 250;

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

type Streamer = ReturnType<typeof streamingState>;

// The status poll feeds the watchdog every 250 ms while the page runs; these
// walk it tick by tick so only a real scheduling gap looks like one.
function pollUntil(
  streamer: Streamer,
  statusReport: StatusReport | null,
  first: StallProbe,
  from: number,
  until: number,
): { readonly probe: StallProbe; readonly stalled: boolean } {
  let result = { probe: first, stalled: false };
  for (let now = from + POLL_MS; now <= until; now += POLL_MS) {
    result = detectStreamStall(streamer, statusReport, result.probe, now);
  }
  return result;
}

// M13 (AUDIT-2026-06-10): if GRBL stops acking mid-job there was no watchdog
// anywhere — 'streaming' at a frozen percentage indefinitely, silently.
describe('detectStreamStall (M13)', () => {
  it('flags a stall when no ack arrives and the controller has no Run status', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, null, null, 1_000);
    expect(first.stalled).toBe(false);

    const second = pollUntil(streamer, null, first.probe, 1_000, 1_000 + STREAM_STALL_TIMEOUT_MS);
    expect(second.stalled).toBe(true);
  });

  it('allows a longer watchdog window while the controller is still running', () => {
    const streamer = streamingState();
    const staleRunStatus = report('Run');
    const first = detectStreamStall(streamer, staleRunStatus, null, 1_000);
    expect(first.stalled).toBe(false);

    const second = pollUntil(
      streamer,
      staleRunStatus,
      first.probe,
      1_000,
      1_000 + STREAM_STALL_TIMEOUT_MS,
    );
    expect(second.stalled).toBe(false);

    const third = pollUntil(
      streamer,
      staleRunStatus,
      second.probe,
      1_000 + STREAM_STALL_TIMEOUT_MS,
      1_000 + STREAM_STALL_RUNNING_TIMEOUT_MS,
    );
    expect(third.stalled).toBe(true);
  });

  it('resets the clock when the stream makes progress', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, report('Run'), null, 1_000);
    const waited = pollUntil(streamer, null, first.probe, 1_000, 1_000 + STREAM_STALL_TIMEOUT_MS);
    // An ack arrived: completed advanced.
    const progressed = { ...streamer, completed: streamer.completed + 1 };
    const second = detectStreamStall(
      progressed,
      null,
      waited.probe,
      1_000 + STREAM_STALL_TIMEOUT_MS + POLL_MS,
    );
    expect(second.stalled).toBe(false);
    expect(second.probe?.at).toBe(1_000 + STREAM_STALL_TIMEOUT_MS + POLL_MS);
  });

  it('does not flag a stall while fresh Run status reports keep arriving', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, report('Run'), null, 1_000);
    const freshRunStatus = report('Run');
    const second = detectStreamStall(
      streamer,
      freshRunStatus,
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

  // ADR-356: a page that stopped running (long task, hidden tab, sleep)
  // observed nothing in between; the controller's silence starts counting
  // again only from the tick that resumed.
  it('restarts the clock after a host scheduling gap instead of counting it as controller silence', () => {
    const streamer = streamingState();
    const staleRunStatus = report('Run');
    const first = detectStreamStall(streamer, staleRunStatus, null, 1_000);
    const afterStall = detectStreamStall(
      streamer,
      staleRunStatus,
      first.probe,
      1_000 + STREAM_STALL_RUNNING_TIMEOUT_MS + 5_000,
    );

    expect(afterStall.stalled).toBe(false);
    expect(afterStall.probe?.at).toBe(1_000 + STREAM_STALL_RUNNING_TIMEOUT_MS + 5_000);
  });

  it('still flags a controller that stays silent once the host is polling again', () => {
    const streamer = streamingState();
    const first = detectStreamStall(streamer, null, null, 1_000);
    const resumedAt = 1_000 + HOST_SCHEDULING_GAP_MS + 30_000;
    const afterStall = detectStreamStall(streamer, null, first.probe, resumedAt);
    const silent = pollUntil(
      streamer,
      null,
      afterStall.probe,
      resumedAt,
      resumedAt + STREAM_STALL_TIMEOUT_MS,
    );

    expect(afterStall.stalled).toBe(false);
    expect(silent.stalled).toBe(true);
  });

  it('keeps counting across ticks that are late but inside the scheduling gap', () => {
    const streamer = streamingState();
    let result = detectStreamStall(streamer, null, null, 1_000);
    const lateTick = HOST_SCHEDULING_GAP_MS - 1;
    let now = 1_000;
    while (now - 1_000 < STREAM_STALL_TIMEOUT_MS) {
      now += lateTick;
      result = detectStreamStall(streamer, null, result.probe, now);
    }

    expect(result.probe?.at).toBe(1_000);
    expect(result.stalled).toBe(true);
  });
});

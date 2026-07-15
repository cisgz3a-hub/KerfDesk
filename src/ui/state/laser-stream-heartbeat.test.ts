import { describe, expect, it } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import {
  ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
  detectActiveStreamHeartbeatLoss,
} from './laser-stream-heartbeat';

function streamingJob() {
  return step(createStreamer('G1 X1 S100\nG1 X2 S100\n')).state;
}

function observation(sequence: number, sessionEpoch = 1) {
  return { sessionEpoch, positionEpoch: 1, sequence, observedAt: sequence };
}

describe('detectActiveStreamHeartbeatLoss', () => {
  it('faults after an active stream misses the heartbeat window', () => {
    const first = detectActiveStreamHeartbeatLoss(streamingJob(), observation(4), null, 1_000);
    const fault = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(4),
      first.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
    );

    expect(first.lost).toBe(false);
    expect(fault.lost).toBe(true);
  });

  it('restarts the window for every fresh same-session status report', () => {
    const first = detectActiveStreamHeartbeatLoss(streamingJob(), observation(4), null, 1_000);
    const fresh = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(5),
      first.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
    );

    expect(fresh.lost).toBe(false);
    expect(fresh.probe?.statusSequence).toBe(5);
    expect(fresh.probe?.at).toBe(1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS);
  });

  it('does not monitor a paused stream', () => {
    const paused = { ...streamingJob(), status: 'paused' as const };
    const result = detectActiveStreamHeartbeatLoss(paused, observation(4), null, 10_000);

    expect(result).toEqual({ probe: null, lost: false });
  });

  it('continues monitoring after all lines are acknowledged but motion may still be finishing', () => {
    const done = { ...streamingJob(), status: 'done' as const };
    const first = detectActiveStreamHeartbeatLoss(done, observation(4), null, 1_000);
    const fault = detectActiveStreamHeartbeatLoss(
      done,
      observation(4),
      first.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
    );

    expect(fault.lost).toBe(true);
  });

  it('restarts ownership when the controller session changes', () => {
    const first = detectActiveStreamHeartbeatLoss(streamingJob(), observation(4), null, 1_000);
    const nextSession = detectActiveStreamHeartbeatLoss(
      streamingJob(),
      observation(4, 2),
      first.probe,
      1_000 + ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS,
    );

    expect(nextSession.lost).toBe(false);
    expect(nextSession.probe?.sessionEpoch).toBe(2);
  });
});

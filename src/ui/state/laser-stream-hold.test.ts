import { describe, expect, it } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { initialLaserState, type StallProbe } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import {
  controllerUnresponsiveNotice,
  describeStreamHold,
  sameStreamHoldEpisode,
  STREAM_HOLD_NOTICE_MS,
  STREAM_HOLD_VISIBLE_MS,
  streamHoldFromProbe,
  streamHoldPatch,
  streamHoldSeconds,
} from './laser-stream-hold';

function streamingState(overrides: Partial<LaserState> = {}): LaserState {
  const streamer = step(createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100\nG1 X4 S0')).state;
  return {
    ...initialLaserState(),
    streamer,
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
      buffer: { plannerBlocksFree: 512, rxBytesFree: 65535 },
    },
    ...overrides,
  } as LaserState;
}

function probeAt(at: number, state: LaserState): StallProbe {
  const streamer = state.streamer;
  if (streamer === null) return null;
  return {
    completed: streamer.completed,
    inFlightBytes: streamer.inFlightBytes,
    queuedCount: streamer.queued.length - streamer.queueIndex,
    statusReport: state.statusReport,
    at,
  };
}

const refs = {};

describe('streamHoldFromProbe', () => {
  it('is null while the sent lines are younger than the visibility window', () => {
    const state = streamingState();
    expect(
      streamHoldFromProbe(state, probeAt(1_000, state), 1_000 + STREAM_HOLD_VISIBLE_MS - 1),
    ).toBeNull();
  });

  it('names the wait once the window passes, with the in-flight facts', () => {
    const state = streamingState();
    const hold = streamHoldFromProbe(state, probeAt(1_000, state), 1_000 + STREAM_HOLD_VISIBLE_MS);
    expect(hold).toEqual({
      since: 1_000,
      observedAt: 1_000 + STREAM_HOLD_VISIBLE_MS,
      unacknowledgedLines: 4,
      unacknowledgedBytes: state.streamer?.inFlightBytes,
      controllerState: 'Idle',
    });
    expect(streamHoldSeconds(hold as NonNullable<typeof hold>)).toBe(3);
  });

  it('is null without a probe, without a streaming job, or with nothing in flight', () => {
    const state = streamingState();
    expect(streamHoldFromProbe(state, null, 10_000)).toBeNull();
    const idle = streamingState({ streamer: null });
    expect(streamHoldFromProbe(idle, probeAt(0, state), 10_000)).toBeNull();
    const drained = streamingState({
      streamer: {
        ...(state.streamer as NonNullable<LaserState['streamer']>),
        inFlight: [],
        inFlightBytes: 0,
      },
    });
    expect(streamHoldFromProbe(drained, probeAt(0, drained), 10_000)).toBeNull();
  });
});

describe('streamHoldPatch', () => {
  it('logs the facts once when an episode begins and refreshes silently after', () => {
    const state = streamingState();
    const first = streamHoldFromProbe(state, probeAt(1_000, state), 5_000);
    const began = streamHoldPatch(state, refs, first);
    expect(began.streamHold).toBe(first);
    expect(began.log?.at(-1)).toContain(
      'Controller holding program: reports Idle with 4 sent lines',
    );
    expect(began.log?.at(-1)).toContain('Bf 512 blocks / 65535 B free');
    expect(began.log?.at(-1)).toContain('has not reset the controller');
    expect(began.safetyNotice).toBeUndefined();

    const holding = { ...state, streamHold: first, log: began.log ?? [] } as LaserState;
    const later = streamHoldFromProbe(holding, probeAt(1_000, holding), 6_000);
    const refreshed = streamHoldPatch(holding, refs, later);
    expect(refreshed.streamHold).toBe(later);
    expect(refreshed.log).toBeUndefined();
  });

  it('logs the duration when the controller resumes', () => {
    const state = streamingState();
    const hold = streamHoldFromProbe(state, probeAt(1_000, state), 61_000);
    const holding = { ...state, streamHold: hold } as LaserState;
    const ended = streamHoldPatch(holding, refs, null);
    expect(ended.streamHold).toBeNull();
    expect(ended.log?.at(-1)).toBe(
      '[lf2] Controller resumed acknowledging after holding the program for 60 s.',
    );
  });

  it('raises the safety notice only once the wait outlasts the watchdog window', () => {
    const state = streamingState();
    const early = streamHoldFromProbe(
      state,
      probeAt(1_000, state),
      1_000 + STREAM_HOLD_NOTICE_MS - 1,
    );
    expect(streamHoldPatch(state, refs, early).safetyNotice).toBeUndefined();
    const late = streamHoldFromProbe(state, probeAt(1_000, state), 1_000 + STREAM_HOLD_NOTICE_MS);
    const notice = streamHoldPatch(state, refs, late).safetyNotice;
    expect(notice?.kind).toBe('stream-stalled');
    expect(notice?.message).toContain('has not reset the controller');
    expect(notice?.message).not.toContain('requested a controller soft reset');
    const alreadyNoticed = { ...state, safetyNotice: notice ?? null } as LaserState;
    expect(streamHoldPatch(alreadyNoticed, refs, late).safetyNotice).toBeUndefined();
  });
});

describe('sameStreamHoldEpisode / copy', () => {
  it('treats the same start time as one episode', () => {
    const a = {
      since: 1,
      observedAt: 2,
      unacknowledgedLines: 1,
      unacknowledgedBytes: 9,
      controllerState: 'Idle',
    };
    expect(sameStreamHoldEpisode(a, { ...a, observedAt: 9 })).toBe(true);
    expect(sameStreamHoldEpisode(a, { ...a, since: 2 })).toBe(false);
    expect(sameStreamHoldEpisode(null, null)).toBe(true);
    expect(sameStreamHoldEpisode(a, null)).toBe(false);
  });

  it('describes the wait for the bar with the Falcon hint only when asked', () => {
    const hold = {
      since: 0,
      observedAt: 12_000,
      unacknowledgedLines: 41,
      unacknowledgedBytes: 1008,
      controllerState: 'Idle',
    };
    expect(describeStreamHold(hold, false)).toBe(
      'The controller reports Idle and has not acknowledged the last 41 sent lines for 12 s. ' +
        'KerfDesk is connected and waiting; nothing was reset',
    );
    expect(describeStreamHold(hold, true)).toContain('$152=100');
    expect(controllerUnresponsiveNotice(hold).message).toContain('$152');
  });
});

import { describe, expect, it } from 'vitest';
import { createStreamer, onAck, step, type StatusReport } from '../../core/controllers/grbl';
import { marlinDriver } from '../../core/controllers';
import { initialLaserState } from './laser-store-helpers';
import { detectStreamStall, type StallProbe } from './laser-stream-stall';
import { programmedDwellSeconds } from './laser-stream-dwell';
import type { LaserState } from './laser-store';
import {
  controllerUnresponsiveNotice,
  describeStreamHold,
  sameStreamHoldEpisode,
  STREAM_DWELL_MARGIN_MS,
  STREAM_HOLD_NOTICE_MS,
  STREAM_HOLD_VISIBLE_MS,
  streamHoldFromProbe,
  streamHoldHeading,
  streamHoldPatch,
  streamHoldSeconds,
  type StreamHold,
} from './laser-stream-hold';

// A controller polled with `?` while it streams: its latest report arrived
// after the wait began (probes below start at 1 000).
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
    statusObservation: { sessionEpoch: 0, positionEpoch: 0, sequence: 9, observedAt: 1_250 },
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
    checkedAt: at,
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

// Controller audit MA-9: the copy names only a status report received during
// the wait. Marlin is not polled while it streams, so its last report is the
// pre-job M114, which says nothing about the wait.
describe('stream hold evidence', () => {
  const STALE = { sessionEpoch: 0, positionEpoch: 0, sequence: 3, observedAt: 500 };

  it('names no state from a report older than the wait', () => {
    const state = streamingState({ statusObservation: STALE });
    const hold = streamHoldFromProbe(state, probeAt(1_000, state), 4_000) as StreamHold;
    expect(hold.controllerState).toBeNull();
    expect(describeStreamHold(hold, false)).toBe(
      'The controller has sent no fresh status report and has not acknowledged the last 4 sent ' +
        'lines for 3 s. KerfDesk is connected and waiting; nothing was reset',
    );
    expect(controllerUnresponsiveNotice(hold).message).toContain(
      'for 3 s and sent no status report meanwhile.',
    );
  });

  it('says a Marlin stream is not polled for status instead of naming its pre-job M114', () => {
    const state = streamingState({
      capabilities: marlinDriver.capabilities,
      activeControllerKind: 'marlin',
      statusObservation: STALE,
    });
    const hold = streamHoldFromProbe(state, probeAt(1_000, state), 91_000) as StreamHold;
    expect(hold).toMatchObject({ controllerState: null, statusNotPolled: true });
    expect(describeStreamHold(hold, false)).toBe(
      'The controller, whose status is not polled while it streams, has not acknowledged the ' +
        'last 4 sent lines for 90 s. KerfDesk is connected and waiting; nothing was reset',
    );
    const patch = streamHoldPatch(state, refs, hold);
    expect(patch.log?.at(-1)).toContain(
      'Controller holding program: no status is polled while it streams, with 4 sent lines',
    );
    expect(patch.safetyNotice?.message).toContain(
      "sent no busy report meanwhile; KerfDesk does not poll this controller's status",
    );
    expect(patch.safetyNotice?.message).not.toMatch(/reporting|answering status/);
  });

  it('restarts the watchdog when a busy keepalive arrived since the last tick', () => {
    const { streamer } = streamingState();
    let probe = detectStreamStall(streamer, null, null, 1_000).probe;
    for (let now = 1_250; now <= 3_000; now += 250) {
      probe = detectStreamStall(streamer, null, probe, now).probe;
    }
    expect(probe?.at).toBe(1_000);
    probe = detectStreamStall(streamer, null, probe, 3_250, 3_100).probe;
    expect(probe?.at).toBe(3_250);
    probe = detectStreamStall(streamer, null, probe, 3_500, 3_100).probe;
    expect(probe?.at).toBe(3_250);
    // A busy time later than now is not this session's.
    probe = detectStreamStall(streamer, null, probe, 3_750, 9_000).probe;
    expect(probe?.at).toBe(3_250);
  });
});

// Controller audit ST-5: GRBL answers `G4 P<s>` only after the dwell and
// reports Idle meanwhile (motion_control.c L195-L200), so a spindle spin-up
// dwell looked like the controller holding the program.
describe('a programmed G4 dwell', () => {
  const IDLE = { ...streamingState().statusReport, buffer: null } as StatusReport;

  function dwellingState(): LaserState {
    let streamer = step(createStreamer('G0 Z5\nM3 S12000\nG4 P5\nG1 X10 F500\nG1 X20\n')).state;
    streamer = step(onAck(streamer, 'ok').state).state;
    streamer = step(onAck(streamer, 'ok').state).state;
    expect(streamer.inFlight[0]?.line).toBe('G4 P5\n');
    return streamingState({
      streamer,
      statusReport: IDLE,
      statusObservation: { sessionEpoch: 0, positionEpoch: 0, sequence: 40, observedAt: 13_900 },
    });
  }

  function probeUntil(state: LaserState, end: number): StallProbe {
    let probe = detectStreamStall(state.streamer, IDLE, null, 10_000).probe;
    for (let now = 10_250; now <= end; now += 250) {
      probe = detectStreamStall(state.streamer, IDLE, probe, now).probe;
    }
    return probe;
  }

  it('is named as the dwell it is, with no hold logged and no notice', () => {
    const state = dwellingState();
    const hold = streamHoldFromProbe(state, probeUntil(state, 14_000), 14_000) as StreamHold;
    expect(hold.dwellSeconds).toBe(5);
    expect(streamHoldHeading(hold)).toBe('DWELLING (SPINDLE SPIN-UP)');
    expect(describeStreamHold(hold, true)).toBe(
      "The controller is running the program's 5 s G4 dwell (4 s so far). KerfDesk is " +
        'connected and waiting; nothing was reset',
    );
    expect(streamHoldPatch(state, refs, hold)).toEqual({ streamHold: hold });
  });

  it('becomes a controller hold once the dwell outlasts its time and the margin', () => {
    const state = dwellingState();
    const end = 10_000 + 5_000 + STREAM_DWELL_MARGIN_MS;
    const hold = streamHoldFromProbe(state, probeUntil(state, end), end) as StreamHold;
    expect(hold.dwellSeconds).toBeUndefined();
    expect(streamHoldHeading(hold)).toBe('CONTROLLER HOLDING PROGRAM');
    const dwelling = { ...hold, dwellSeconds: 5 };
    expect(sameStreamHoldEpisode(dwelling, hold)).toBe(false);
    const patch = streamHoldPatch({ ...state, streamHold: dwelling }, refs, hold);
    expect(patch.log?.at(-1)).toContain('Controller holding program: reports Idle');
  });

  it('reads G4 P as seconds only in the GRBL family', () => {
    expect(programmedDwellSeconds('grblhal', 'G4 P2.5 (spin-up)\n')).toBe(2.5);
    expect(programmedDwellSeconds('grbl-v1.1', 'G04 P3\n')).toBe(3);
    expect(programmedDwellSeconds('grbl-v1.1', 'G1 X4 P3\n')).toBeNull();
    expect(programmedDwellSeconds('marlin', 'G4 P5\n')).toBeNull();
  });
});

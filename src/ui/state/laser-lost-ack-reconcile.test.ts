// The rules behind the lost-reply probe (ADR-610 Amendment 1): which firmware
// it may ask, when its deadlines run, and who owns its reply.

import { afterEach, describe, expect, it } from 'vitest';
import { grblDriver, selectControllerDriver } from '../../core/controllers';
import { createStreamer } from '../../core/controllers/grbl';
import {
  handleLostReplyProbeLine,
  hasOrderedProbe,
  LOST_REPLY_PROBE_REPLY_GRACE_MS,
  reconcileLostStreamAcknowledgements,
  reportShowsIdle,
} from './laser-lost-ack-reconcile';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { shouldReleaseStreamerAtIdle } from './laser-terminal-stream-release';

afterEach(() => {
  useLaserStore.setState(initialLaserState());
});

describe('lost-reply proof rules', () => {
  it('probes only controllers that answer $G in order behind job lines', () => {
    for (const kind of ['grbl-v1.1', 'grblhal', 'fluidnc'] as const) {
      expect(hasOrderedProbe(selectControllerDriver(kind), kind)).toBe(true);
    }
    const falcon = selectControllerDriver('grblhal', 'creality-falcon-a1-pro');
    expect(hasOrderedProbe(falcon, 'grblhal')).toBe(true);
    expect(hasOrderedProbe(selectControllerDriver('smoothieware'), 'smoothieware')).toBe(false);
    expect(hasOrderedProbe(selectControllerDriver('marlin'), 'marlin')).toBe(false);
  });

  it('requires the firmware itself to be identified, not only the profile', () => {
    const grbl = selectControllerDriver('grbl-v1.1');
    // The profile's driver stays in use when a banner names other firmware.
    expect(hasOrderedProbe(grbl, 'grblhal')).toBe(true);
    expect(hasOrderedProbe(grbl, 'smoothieware', true)).toBe(false);
    expect(hasOrderedProbe(grbl, 'marlin')).toBe(false);
    // No banner: only a stock GRBL $I reply this session identifies it.
    expect(hasOrderedProbe(grbl, null)).toBe(false);
    expect(hasOrderedProbe(grbl, null, true)).toBe(true);
  });

  it('accepts only a current-session Idle report', () => {
    const stamp = (sessionEpoch: number) => ({
      sessionEpoch,
      positionEpoch: 0,
      sequence: 1,
      observedAt: 1,
    });
    const report = (state: string) => ({ state }) as never;
    const base = { controllerSessionEpoch: 3, statusObservation: stamp(3) };
    expect(reportShowsIdle({ ...base, statusReport: report('Idle') })).toBe(true);
    expect(reportShowsIdle({ ...base, statusReport: report('Run') })).toBe(false);
    expect(
      reportShowsIdle({ ...base, statusObservation: stamp(2), statusReport: report('Idle') }),
    ).toBe(false);
  });

  it('keeps a finished stream mounted while its probe still owes a reply', () => {
    const idle = { state: 'Idle' } as never;
    const probe = {
      writeEpoch: 2,
      sessionEpoch: 1,
      streamerEpoch: 1,
      linesBefore: 7,
      sentAt: 0,
      writtenAt: 0,
      provenAt: null,
      streamEndedAt: null,
      replied: false,
    };
    const done = { streamer: { status: 'done' } as never, controllerOperation: null };
    const errored = { streamer: { status: 'errored' } as never, controllerOperation: null };
    expect(shouldReleaseStreamerAtIdle(done, idle)).toBe(true);
    expect(shouldReleaseStreamerAtIdle(done, idle, { writeEpoch: 2, lostReplyProbe: probe })).toBe(
      false,
    );
    // A reset moved the session on: the probe is no longer owed anything.
    expect(shouldReleaseStreamerAtIdle(done, idle, { writeEpoch: 3, lostReplyProbe: probe })).toBe(
      true,
    );
    expect(
      shouldReleaseStreamerAtIdle(errored, idle, { writeEpoch: 2, lostReplyProbe: probe }),
    ).toBe(true);
  });
});

describe('probe deadlines on the status poll schedule', () => {
  const proven = {
    writeEpoch: 1,
    sessionEpoch: 1,
    streamerEpoch: 1,
    linesBefore: 7,
    sentAt: 0,
    writtenAt: 0,
    provenAt: 0 as number | null,
    streamEndedAt: null,
    replied: false,
  };
  const run = (
    schedule: { lastTickAt: number; resumedAt: number },
    now: number,
    probe: typeof proven = proven,
    streamer: unknown = null,
  ) => {
    const refs = {
      writeEpoch: 1,
      lostReplyProbe: { ...probe },
      statusPollSchedule: schedule,
      untrackedAckReservations: [{ writeEpoch: 1, motionOperationId: null, remaining: 1 }],
    } as never as Parameters<typeof reconcileLostStreamAcknowledgements>[2];
    const store = { ...initialLaserState(), pendingUntrackedAcks: 1, streamer } as never as {
      pendingUntrackedAcks: number;
    };
    const set = (patch: unknown) =>
      Object.assign(store, typeof patch === 'function' ? patch(store) : patch);
    const finished = reconcileLostStreamAcknowledgements(
      set as never,
      () => store as never,
      refs,
      (async () => undefined) as never,
      now,
    );
    return { finished, refs, store };
  };

  it('keeps a proven probe waiting for its reply after a scheduling gap', () => {
    // The page slept past the grace period; its queued replies are still being read.
    const resumed = run({ lastTickAt: 60_000, resumedAt: 60_000 }, 60_000);
    expect(resumed.finished).toBe(false);
    expect(resumed.refs.lostReplyProbe).not.toBeNull();
    expect(resumed.store.pendingUntrackedAcks).toBe(1);
  });

  it('retires the probe once its grace has run on schedule', () => {
    const onSchedule = run(
      { lastTickAt: LOST_REPLY_PROBE_REPLY_GRACE_MS - 250, resumedAt: Number.NEGATIVE_INFINITY },
      LOST_REPLY_PROBE_REPLY_GRACE_MS,
    );
    expect(onSchedule.finished).toBe(true);
    expect(onSchedule.refs.lostReplyProbe).toBeNull();
    expect(onSchedule.store.pendingUntrackedAcks).toBe(0);
  });
});

describe('probe give-up starts once the job has ended and the probe is on the wire', () => {
  type Refs = Parameters<typeof reconcileLostStreamAcknowledgements>[2];
  const onSchedule = (now: number) => ({
    lastTickAt: now - 250,
    resumedAt: Number.NEGATIVE_INFINITY,
  });
  const harness = (streamer: unknown, writtenAt: number | null) => {
    const refs = {
      writeEpoch: 1,
      lostReplyProbe: {
        writeEpoch: 1,
        sessionEpoch: 0,
        streamerEpoch: 0,
        linesBefore: 7,
        sentAt: 0,
        writtenAt,
        provenAt: null,
        streamEndedAt: null,
        replied: false,
      },
      statusPollSchedule: onSchedule(0),
      untrackedAckReservations: [{ writeEpoch: 1, motionOperationId: null, remaining: 1 }],
    } as never as Refs;
    const store = { ...initialLaserState(), pendingUntrackedAcks: 1, streamer } as never as {
      pendingUntrackedAcks: number;
      streamer: unknown;
    };
    const set = (patch: unknown) =>
      Object.assign(store, typeof patch === 'function' ? patch(store) : patch);
    const tick = (now: number): boolean => {
      Object.assign(refs, { statusPollSchedule: onSchedule(now) });
      return reconcileLostStreamAcknowledgements(
        set as never,
        () => store as never,
        refs,
        (async () => undefined) as never,
        now,
      );
    };
    return { refs, store, tick };
  };
  const streaming = {
    status: 'streaming',
    inFlight: [{ line: 'M5\n', bytes: 3 }],
    queued: [],
    queueIndex: 0,
  };

  it('does not age the give-up while a held program keeps the job streaming', () => {
    const run = harness(streaming, 0);
    expect(run.tick(60_000)).toBe(false);
    expect(run.refs.lostReplyProbe?.streamEndedAt).toBeNull();
    // The held replies arrive: the job ends now, so the clock starts now.
    run.store.streamer = { status: 'done', inFlight: [], queued: [], queueIndex: 0 };
    expect(run.tick(60_250)).toBe(false);
    expect(run.tick(65_000)).toBe(false);
    expect(run.refs.lostReplyProbe).not.toBeNull();
    expect(run.tick(70_500)).toBe(true);
    expect(run.refs.lostReplyProbe).toBeNull();
    expect(run.store.pendingUntrackedAcks).toBe(0);
  });

  it('retires an unanswered probe after the job errored and was released', () => {
    const run = harness(null, 0);
    expect(run.tick(1_000)).toBe(false);
    expect(run.tick(12_000)).toBe(true);
    expect(run.store.pendingUntrackedAcks).toBe(0);
  });

  it('keeps an unanswered probe whose write is still pending', () => {
    const run = harness({ status: 'done', inFlight: [], queued: [], queueIndex: 0 }, null);
    expect(run.tick(1_000)).toBe(false);
    expect(run.tick(60_000)).toBe(false);
    expect(run.refs.lostReplyProbe).not.toBeNull();
    expect(run.store.pendingUntrackedAcks).toBe(1);
  });
});

describe('a Pause pressed while the probe is out', () => {
  type Refs = Parameters<typeof handleLostReplyProbeLine>[2];
  const LINES = ['G1 X1', 'G1 X2', 'G1 X3', 'G1 X4', 'G1 X5', 'G1 X6', 'G1 X7'];

  function pausedWithLostTail(): Refs {
    const created = createStreamer(LINES.join('\n'));
    const inFlight = created.queued.slice(5).map((line) => ({ line, bytes: line.length }));
    useLaserStore.setState({
      ...initialLaserState(),
      connection: { kind: 'connected' },
      controllerSessionEpoch: 1,
      streamerEpoch: 1,
      pendingUntrackedAcks: 1,
      streamer: {
        ...created,
        status: 'paused',
        queueIndex: created.queued.length,
        inFlight,
        inFlightBytes: inFlight.reduce((sum, item) => sum + item.bytes, 0),
        completed: 5,
      },
    });
    return {
      writeEpoch: 1,
      driver: grblDriver,
      connection: null,
      untrackedAckReservations: [{ writeEpoch: 1, motionOperationId: null, remaining: 1 }],
      lostReplyProbe: {
        writeEpoch: 1,
        sessionEpoch: 1,
        streamerEpoch: 1,
        linesBefore: 7,
        sentAt: 0,
        writtenAt: 0,
        provenAt: null,
        streamEndedAt: null,
        replied: false,
      },
    } as never as Refs;
  }

  const handle = (refs: Refs, kind: string, line: string): void =>
    handleLostReplyProbeLine(
      useLaserStore.setState,
      useLaserStore.getState,
      refs,
      (async () => undefined) as never,
      kind,
      line,
    );

  it('applies the lost replies to the paused job, which stays paused, before the probe takes its reply', () => {
    const refs = pausedWithLostTail();
    // While the job still claims replies, a terminal reply is never the probe's.
    handle(refs, 'ok', 'ok');
    expect(refs.lostReplyProbe?.replied).toBe(false);

    handle(refs, 'message', '[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
    const streamer = useLaserStore.getState().streamer;
    expect(streamer?.status).toBe('paused');
    expect(streamer?.inFlight).toHaveLength(0);
    expect(streamer?.completed).toBe(7);

    handle(refs, 'ok', 'ok');
    expect(refs.lostReplyProbe?.replied).toBe(true);
  });
});

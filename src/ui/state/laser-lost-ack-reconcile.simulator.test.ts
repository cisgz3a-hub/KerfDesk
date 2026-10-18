// A job whose last replies were lost on the serial link finishes on the
// controller's own ordered `$G` answer instead of a watchdog soft reset
// (ADR-610 Amendment 1).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver, selectControllerDriver } from '../../core/controllers';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import {
  hasOrderedProbe,
  LOST_REPLY_PROBE_AFTER_MS,
  LOST_REPLY_PROBE_REPLY_GRACE_MS,
  reconcileLostStreamAcknowledgements,
  reportShowsIdle,
} from './laser-lost-ack-reconcile';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { startTestLaserJobOnClock } from './laser-test-command-control';
import { shouldReleaseStreamerAtIdle } from './laser-terminal-stream-release';
import { resetStore } from './test-helpers';

type Link = {
  /** Drop these `ok`s (1-based, counted after arming). */
  dropOks: ReadonlyArray<number>;
  okCount: number;
  /** Drop the `ok` that follows the next `[GC:` report: the probe's own reply. */
  dropOkAfterGc: boolean;
  sawGc: boolean;
  /** Once the whole job is on the wire, hold every reply that is not a status
   * report, as a controller holding the tail of its program would. */
  holding: boolean;
  held: string[];
  /** Reject the `$G` write after its bytes reached the controller (an ambiguous failure). */
  rejectProbeWrite: boolean;
  deliverHeld: (() => void) | null;
};

const link = (dropOks: ReadonlyArray<number> = []): Link => ({
  dropOks,
  okCount: -1,
  dropOkAfterGc: false,
  sawGc: false,
  holding: false,
  held: [],
  rejectProbeWrite: false,
  deliverHeld: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetStore();
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({ ...initialLaserState(), capabilities: grblDriver.capabilities });
  resetStore();
  vi.restoreAllMocks();
});

function wholeJobSent(): boolean {
  const streamer = useLaserStore.getState().streamer;
  return streamer !== null && streamer.queueIndex >= streamer.queued.length;
}

// The firmware sent the reply; the host never read it, as after a UART line
// error on a noisy link.
function lossyAdapter(sim: GrblSimulator, wire: Link): PlatformAdapter {
  const deliver = (line: string, handler: (line: string) => void): void => {
    const isStatus = line.trim().startsWith('<');
    if (wire.holding && !isStatus && wholeJobSent()) {
      wire.held.push(line);
      wire.deliverHeld = () => wire.held.splice(0).forEach((held) => handler(held));
      return;
    }
    if (wire.dropOkAfterGc && line.trim().startsWith('[GC:')) wire.sawGc = true;
    if (line.trim() === 'ok' && wire.sawGc) {
      wire.sawGc = false;
      wire.dropOkAfterGc = false;
      return;
    }
    if (line.trim() === 'ok' && wire.okCount >= 0) {
      wire.okCount += 1;
      if (wire.dropOks.includes(wire.okCount)) return;
    }
    handler(line);
  };
  return {
    ...sim.adapter,
    serial: {
      ...sim.adapter.serial,
      requestPort: async (...args: Parameters<PlatformAdapter['serial']['requestPort']>) => {
        const port = await sim.adapter.serial.requestPort(...args);
        if (port === null) return null;
        return {
          ...port,
          open: async (...openArgs: Parameters<typeof port.open>) => {
            const connection = await port.open(...openArgs);
            const lossy: SerialConnection = {
              ...connection,
              write: async (data) => {
                await connection.write(data);
                if (wire.rejectProbeWrite && data === '$G\n') {
                  throw new Error('USB adapter failed after sending');
                }
              },
              onLine: (handler) => connection.onLine((line) => deliver(line, handler)),
            };
            return lossy;
          },
        };
      },
    },
  };
}

async function connectIdle(wire: Link): Promise<GrblSimulator> {
  const sim = createGrblSimulator();
  await useLaserStore.getState().connect(lossyAdapter(sim, wire));
  await vi.advanceTimersByTimeAsync(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
  return sim;
}

const JOB = 'G21\nG90\nM4 S0\nG1 X10 Y0 F600 S100\nG1 X10 Y5 F600 S100\nM5\nG0 X0 Y0\n';

/** Advance until the job is released, returning how long that took. */
async function msUntilReleased(limitMs: number): Promise<number | null> {
  for (let elapsed = 0; elapsed <= limitMs; elapsed += 250) {
    const state = useLaserStore.getState();
    if (state.streamer === null && state.controllerOperation === null) return elapsed;
    await vi.advanceTimersByTimeAsync(250);
  }
  return null;
}

function sentSoftReset(sim: GrblSimulator): boolean {
  return sim.outbound().some((payload) => payload.includes('\x18'));
}

function probesSent(sim: GrblSimulator): number {
  const outbound = sim.outbound();
  const jobStart = outbound.findIndex((payload) => payload.includes('G1 X10 Y0'));
  return outbound.slice(jobStart).filter((payload) => payload === '$G\n').length;
}

function expectCleanFinish(sim: GrblSimulator): void {
  const state = useLaserStore.getState();
  expect(state.safetyNotice).toBeNull();
  expect(state.pendingUntrackedAcks).toBe(0);
  expect(state.controllerQualification.kind).toBe('qualified');
  expect(state.getControllerReconnectRecommended()).toBe(false);
  expect(sentSoftReset(sim)).toBe(false);
  expect(sim.outbound()).toContain('G4 P0.01\n');
  expect(state.log.join('\n')).toMatch(/Controller settled after job/);
}

describe('lost job-line replies at the end of a job', () => {
  it('asks the controller for $G and finishes on its ordered answer', async () => {
    const wire = link([5]);
    const sim = await connectIdle(wire);
    wire.okCount = 0;
    await startTestLaserJobOnClock(JOB);

    const releasedAfter = await msUntilReleased(20_000);

    expect(releasedAfter).not.toBeNull();
    expect(releasedAfter).toBeGreaterThanOrEqual(LOST_REPLY_PROBE_AFTER_MS);
    expect(releasedAfter).toBeLessThan(5_000);
    expect(probesSent(sim)).toBe(1);
    expectCleanFinish(sim);
    expect(useLaserStore.getState().log.join('\n')).toMatch(
      /1 job line reply was lost on the serial link: the controller answered \$G only after reading every line/,
    );
  });

  it('never finishes early while the controller holds its program, then completes through the replies', async () => {
    const wire = link();
    const sim = await connectIdle(wire);
    wire.okCount = 0;
    wire.holding = true;
    await startTestLaserJobOnClock(JOB);

    // Idle reports keep arriving while every reply waits in the controller.
    await vi.advanceTimersByTimeAsync(30_000);
    let state = useLaserStore.getState();
    expect(state.streamer?.status).toBe('streaming');
    expect(probesSent(sim)).toBe(1);
    expect(state.log.join('\n')).not.toMatch(/lost on the serial link/);

    wire.holding = false;
    wire.deliverHeld?.();
    expect(await msUntilReleased(10_000)).not.toBeNull();
    expectCleanFinish(sim);
    state = useLaserStore.getState();
    expect(state.log.join('\n')).not.toMatch(/lost on the serial link/);
  });

  it('finishes when the probe’s own reply is lost after its [GC:] report', async () => {
    const wire = link([5]);
    const sim = await connectIdle(wire);
    wire.okCount = 0;
    wire.dropOkAfterGc = true;
    await startTestLaserJobOnClock(JOB);

    expect(await msUntilReleased(20_000)).not.toBeNull();
    expectCleanFinish(sim);
    expect(useLaserStore.getState().log.join('\n')).toMatch(/\$G confirmation was lost/);
  });

  it('keeps the probe owner through an ambiguous write failure and finishes on its late reply', async () => {
    const wire = link([5]);
    const sim = await connectIdle(wire);
    wire.okCount = 0;
    wire.rejectProbeWrite = true;
    await startTestLaserJobOnClock(JOB);

    expect(await msUntilReleased(20_000)).not.toBeNull();
    const state = useLaserStore.getState();
    expect(probesSent(sim)).toBe(1);
    // The failure is reported, but the probe's reply still settled its own reservation.
    expect(state.safetyNotice).toMatchObject({ kind: 'write-failed', action: 'stream-probe' });
    expect(state.pendingUntrackedAcks).toBe(0);
    expect(sentSoftReset(sim)).toBe(false);
    expect(sim.outbound()).toContain('G4 P0.01\n');
    expect(state.log.join('\n')).toMatch(/Controller settled after job/);
    expect(state.log.join('\n')).toMatch(/1 job line reply was lost on the serial link/);
  });

  it('completes an undisturbed job exactly as before, without a probe', async () => {
    const wire = link();
    const sim = await connectIdle(wire);
    wire.okCount = 0;
    await startTestLaserJobOnClock(JOB);

    const releasedAfter = await msUntilReleased(10_000);

    expect(releasedAfter).not.toBeNull();
    expect(releasedAfter).toBeLessThan(3_000);
    expect(probesSent(sim)).toBe(0);
    expectCleanFinish(sim);
    expect(useLaserStore.getState().log.join('\n')).not.toMatch(/lost on the serial link/);
  });
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

// A job whose last replies were lost on the serial link finishes on the
// controller's own ordered `$G` answer instead of a watchdog soft reset
// (ADR-610 Amendment 1). A GRBL-family board that printed no banner is asked
// only after the sustained-Idle window, and a held tail is never finished
// early on any of them (ADR-610 Amendment 2).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  createSmoothieSimulator,
  type GrblSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { LOST_ACK_IDLE_PROOF_MS, LOST_REPLY_PROBE_AFTER_MS } from './laser-lost-ack-reconcile';
import { useLaserStore, type ConnectControllerOptions } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { startTestLaserJobOnClock } from './laser-test-command-control';
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

type Simulator = Pick<GrblSimulator, 'adapter' | 'outbound'>;

// The firmware sent the reply; the host never read it, as after a UART line
// error on a noisy link.
function lossyAdapter(sim: Simulator, wire: Link): PlatformAdapter {
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

async function connectIdle(
  wire: Link,
  sim: Simulator = createGrblSimulator(),
  options?: ConnectControllerOptions,
): Promise<Simulator> {
  await useLaserStore.getState().connect(lossyAdapter(sim, wire), options);
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

function sentSoftReset(sim: Simulator): boolean {
  return sim.outbound().some((payload) => payload.includes('\x18'));
}

function probesSent(sim: Simulator): number {
  const outbound = sim.outbound();
  const jobStart = outbound.findIndex((payload) => payload.includes('G1 X10 Y0'));
  return outbound.slice(jobStart).filter((payload) => payload === '$G\n').length;
}

function expectCleanFinish(sim: Simulator): void {
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

  it('keeps a held probe reply owned through a long Pause and completes after Resume', async () => {
    const wire = link();
    const sim = await connectIdle(wire);
    wire.okCount = 0;
    wire.holding = true;
    await startTestLaserJobOnClock(JOB);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(probesSent(sim)).toBe(1);

    const pausing = useLaserStore.getState().pauseJob();
    await vi.advanceTimersByTimeAsync(500);
    await pausing;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(useLaserStore.getState().log.join('\n')).not.toMatch(/\$G confirmation was lost/);
    const sent = sim.outbound();
    expect(sent.slice(sent.findIndex((line) => line.includes('G1 X10 Y0')))).not.toContain(
      'G4 P0.01\n',
    );

    const resuming = useLaserStore.getState().resumeJob();
    await vi.advanceTimersByTimeAsync(500);
    await resuming;
    wire.holding = false;
    wire.deliverHeld?.();
    expect(await msUntilReleased(10_000)).not.toBeNull();
    expectCleanFinish(sim);
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

// grblHAL, FluidNC and the Falcon command set print no `$I` that identifies
// them, so a board that does not reboot when the port opens (native USB, or a
// reconnect after KerfDesk's own Disconnect reset it) leaves the firmware
// unidentified for the whole session (ADR-610 Amendment 2).
const NO_BANNER_PROFILES: ReadonlyArray<readonly [string, ConnectControllerOptions]> = [
  ['grblHAL', { controllerKind: 'grblhal' }],
  ['Falcon A1 Pro', { controllerKind: 'grblhal', controllerCommandSet: 'creality-falcon-a1-pro' }],
];

async function connectWithoutBanner(
  wire: Link,
  options: ConnectControllerOptions,
): Promise<Simulator> {
  const sim = createGrblSimulator({ firmware: 'grblhal', emitBannerOnOpen: false });
  await connectIdle(wire, sim, options);
  expect(useLaserStore.getState().detectedControllerKind).toBeNull();
  return sim;
}

describe('a GRBL-family board that printed no banner (ADR-610 Amendment 2)', () => {
  it.each(NO_BANNER_PROFILES)(
    '%s: never finishes a held tail, then completes through the replies',
    async (_name, options) => {
      const wire = link();
      const sim = await connectWithoutBanner(wire, options);
      wire.okCount = 0;
      wire.holding = true;
      await startTestLaserJobOnClock(JOB);

      // Idle reports keep arriving well past the sustained-Idle window while
      // every reply, the probe's included, waits in the controller.
      await vi.advanceTimersByTimeAsync(LOST_ACK_IDLE_PROOF_MS * 2);
      const held = useLaserStore.getState();
      expect(held.streamer?.status).toBe('streaming');
      expect(probesSent(sim)).toBe(1);
      expect(held.log.join('\n')).not.toMatch(/lost on the serial link/);

      wire.holding = false;
      wire.deliverHeld?.();
      expect(await msUntilReleased(10_000)).not.toBeNull();
      expectCleanFinish(sim);
      expect(useLaserStore.getState().log.join('\n')).not.toMatch(/lost on the serial link/);
    },
  );

  it.each(NO_BANNER_PROFILES)(
    '%s: finishes lost final replies on the ordered $G answer after the sustained Idle',
    async (_name, options) => {
      const wire = link([5]);
      const sim = await connectWithoutBanner(wire, options);
      wire.okCount = 0;
      await startTestLaserJobOnClock(JOB);

      // The probe waits for the sustained-Idle window, never less.
      await vi.advanceTimersByTimeAsync(LOST_ACK_IDLE_PROOF_MS - 1_000);
      expect(probesSent(sim)).toBe(0);
      expect(useLaserStore.getState().streamer?.status).toBe('streaming');

      const releasedAfter = await msUntilReleased(15_000);
      expect(releasedAfter).not.toBeNull();
      expect(probesSent(sim)).toBe(1);
      expectCleanFinish(sim);
      expect(useLaserStore.getState().log.join('\n')).toMatch(
        /1 job line reply was lost on the serial link: the controller answered \$G only after reading every line/,
      );
    },
  );
});

describe('identification and firmware without an ordered probe', () => {
  it('stock GRBL with no banner is identified by $I and asked after 1 s', async () => {
    const wire = link([5]);
    const sim = await connectIdle(wire, createGrblSimulator({ emitBannerOnOpen: false }));
    expect(useLaserStore.getState().detectedControllerKind).toBeNull();
    expect(useLaserStore.getState().controllerBuildInfo).not.toBeNull();
    wire.okCount = 0;
    await startTestLaserJobOnClock(JOB);

    const releasedAfter = await msUntilReleased(20_000);
    expect(releasedAfter).not.toBeNull();
    expect(releasedAfter).toBeLessThan(5_000);
    expect(probesSent(sim)).toBe(1);
    expectCleanFinish(sim);
  });

  it('Smoothieware finishes lost final replies after sustained Idle, without a $G', async () => {
    // Smoothieware is answered line by line, so only the last line's reply can be
    // lost with the whole program on the wire.
    const wire = link([7]);
    const sim = createSmoothieSimulator();
    await connectIdle(wire, sim, { controllerKind: 'smoothieware' });
    expect(useLaserStore.getState().detectedControllerKind).toBe('smoothieware');
    wire.okCount = 0;
    await startTestLaserJobOnClock(JOB);

    await vi.advanceTimersByTimeAsync(LOST_ACK_IDLE_PROOF_MS - 2_000);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');

    const releasedAfter = await msUntilReleased(15_000);
    expect(releasedAfter).not.toBeNull();
    expect(probesSent(sim)).toBe(0);
    const state = useLaserStore.getState();
    expect(state.safetyNotice).toBeNull();
    expect(state.pendingUntrackedAcks).toBe(0);
    expect(sentSoftReset(sim)).toBe(false);
    expect(state.log.join('\n')).toMatch(
      /1 job line reply was lost on the serial link: every line had been sent and the controller stayed Idle for 15 s/,
    );
  });
});

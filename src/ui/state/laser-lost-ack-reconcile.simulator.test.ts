// A job whose last replies were lost on the serial link finishes on the
// controller's own evidence instead of a watchdog soft reset (ADR-606).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import {
  LOST_ACK_BUFFER_PROOF_MS,
  LOST_ACK_IDLE_PROOF_MS,
  reportProof,
} from './laser-lost-ack-reconcile';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { startTestLaserJobOnClock } from './laser-test-command-control';
import { resetStore } from './test-helpers';

type Link = {
  /** Drop the n-th `ok` (1-based) after arming. */
  dropOk: number | null;
  okCount: number;
  /** Rewrite each status line's buffer field; null leaves it as the simulator sent it. */
  buffer: ((state: string) => string | null) | null;
};

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

// The firmware sent the reply; the host never read it, as after a UART line
// error on a noisy link.
function lossyAdapter(sim: GrblSimulator, link: Link): PlatformAdapter {
  const deliver = (line: string, handler: (line: string) => void): void => {
    if (line.trim() === 'ok' && link.dropOk !== null) {
      link.okCount += 1;
      if (link.okCount === link.dropOk) return;
    }
    const status = /^<([A-Za-z]+)[^>]*>$/.exec(line.trim());
    const bf = status !== null && link.buffer !== null ? link.buffer(status[1] ?? '') : null;
    handler(bf === null ? line : line.replace(/>\s*$/, `|Bf:${bf}>`));
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
              onLine: (handler) => connection.onLine((line) => deliver(line, handler)),
            };
            return lossy;
          },
        };
      },
    },
  };
}

async function connectIdle(link: Link): Promise<GrblSimulator> {
  const sim = createGrblSimulator();
  await useLaserStore.getState().connect(lossyAdapter(sim, link));
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

describe('lost job-line replies at the end of a job', () => {
  it('finishes the job after a sustained Idle when the controller reports no buffer state', async () => {
    const link: Link = { dropOk: null, okCount: 0, buffer: null };
    const sim = await connectIdle(link);
    link.dropOk = 5;
    await startTestLaserJobOnClock(JOB);

    const releasedAfter = await msUntilReleased(40_000);

    expect(releasedAfter).not.toBeNull();
    expect(releasedAfter).toBeGreaterThanOrEqual(LOST_ACK_IDLE_PROOF_MS);
    expect(releasedAfter).toBeLessThan(25_000);
    const state = useLaserStore.getState();
    expect(state.safetyNotice).toBeNull();
    expect(state.controllerQualification.kind).toBe('qualified');
    expect(state.getControllerReconnectRecommended()).toBe(false);
    expect(sentSoftReset(sim)).toBe(false);
    expect(sim.outbound()).toContain('G4 P0.01\n');
    expect(state.log.join('\n')).toMatch(/1 job line reply was lost on the serial link/);
    expect(state.log.join('\n')).toMatch(/Controller settled after job/);
  });

  it('finishes sooner when the controller reports an empty buffer and planner', async () => {
    const link: Link = {
      dropOk: null,
      okCount: 0,
      buffer: (state) => (state === 'Idle' ? '15,128' : '10,64'),
    };
    const sim = await connectIdle(link);
    link.dropOk = 5;
    await startTestLaserJobOnClock(JOB);

    const releasedAfter = await msUntilReleased(40_000);

    expect(releasedAfter).not.toBeNull();
    expect(releasedAfter).toBeGreaterThanOrEqual(LOST_ACK_BUFFER_PROOF_MS);
    expect(releasedAfter).toBeLessThan(12_000);
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(sentSoftReset(sim)).toBe(false);
    expect(useLaserStore.getState().log.join('\n')).toMatch(/empty receive buffer and planner/);
  });

  it('keeps waiting while the buffer report shows unread input (a controller holding its program)', async () => {
    const link: Link = { dropOk: null, okCount: 0, buffer: () => '15,128' };
    await connectIdle(link);
    link.dropOk = 5;
    // From here on the controller says its receive ring still holds bytes.
    link.buffer = (state) => (state === 'Idle' ? '15,100' : '10,64');
    await startTestLaserJobOnClock(JOB);

    await vi.advanceTimersByTimeAsync(30_000);

    const state = useLaserStore.getState();
    expect(state.streamer?.status).toBe('streaming');
    expect(state.streamer?.inFlight.length).toBeGreaterThan(0);
    expect(state.log.join('\n')).not.toMatch(/lost on the serial link/);
  });

  it('completes an undisturbed job exactly as before', async () => {
    const link: Link = { dropOk: null, okCount: 0, buffer: null };
    const sim = await connectIdle(link);
    await startTestLaserJobOnClock(JOB);

    const releasedAfter = await msUntilReleased(10_000);

    expect(releasedAfter).not.toBeNull();
    expect(releasedAfter).toBeLessThan(3_000);
    expect(sentSoftReset(sim)).toBe(false);
    expect(useLaserStore.getState().log.join('\n')).not.toMatch(/lost on the serial link/);
  });
});

describe('reportProof', () => {
  const stamp = (sessionEpoch: number) => ({
    sessionEpoch,
    positionEpoch: 0,
    sequence: 1,
    observedAt: 1,
  });
  const base = {
    controllerSessionEpoch: 3,
    statusObservation: stamp(3),
    rxCapacityEvidence: { rxBytesFree: 128, plannerBlocksFree: 15, sessionEpoch: 3, observedAt: 1 },
    plannerCapacityEvidence: { plannerBlocksFree: 15, sessionEpoch: 3, observedAt: 1 },
  };
  const report = (
    state: string,
    buffer: { plannerBlocksFree: number; rxBytesFree: number } | null,
  ) => ({ state, buffer }) as never;

  it('accepts only a current-session Idle', () => {
    expect(reportProof({ ...base, statusReport: report('Run', null) })).toBeNull();
    expect(reportProof({ ...base, statusReport: report('Idle', null) })).toBe('idle');
    expect(
      reportProof({
        ...base,
        statusObservation: stamp(2),
        statusReport: report('Idle', null),
      }),
    ).toBeNull();
  });

  it('requires a buffer report to be as empty as the quiescent baseline', () => {
    const empty = { plannerBlocksFree: 15, rxBytesFree: 128 };
    expect(reportProof({ ...base, statusReport: report('Idle', empty) })).toBe('buffer');
    expect(
      reportProof({ ...base, statusReport: report('Idle', { ...empty, rxBytesFree: 100 }) }),
    ).toBeNull();
    expect(
      reportProof({ ...base, statusReport: report('Idle', { ...empty, plannerBlocksFree: 14 }) }),
    ).toBeNull();
    expect(
      reportProof({ ...base, rxCapacityEvidence: null, statusReport: report('Idle', empty) }),
    ).toBeNull();
  });
});

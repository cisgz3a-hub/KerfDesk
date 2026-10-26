// Meta audit M7-P2-1 (the 2026-09-24 CNC audit's MC-2, ADR-103 Amendment 2):
// touch-off sent `G38.2 Z-25 F150` without ever looking at the probe input, so
// a lead that was never clipped on drove the bit into the plate until GRBL's
// ALARM:5 at the end of travel. Driven through the real store against the GRBL
// simulator, whose probe input reports Pn:P while closed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_Z_PROBE_PARAMS, type ProbeRequest } from '../../core/controllers/grbl/probe';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { useLaserStore } from './laser-store';
import { probeCircuitCheck } from './probe-test-touch';
import { resetStore } from './test-helpers';

const Z_REQUEST = { kind: 'z', params: DEFAULT_Z_PROBE_PARAMS } satisfies ProbeRequest;
// An idle machine is polled every 4th 250 ms tick; this spans two polls.
const STATUS_REPORTS_MS = 2_100;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  resetStore();
});

afterEach(async () => {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    probeTestTouch: null,
    workZZeroEvidence: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  for (let tick = 0; tick < 600 && !done; tick += 1) await vi.advanceTimersByTimeAsync(10);
  return tracked;
}

async function connect(): Promise<GrblSimulator> {
  const sim = createGrblSimulator();
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'grbl-v1.1' });
  await vi.advanceTimersByTimeAsync(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

async function setProbeInput(sim: GrblSimulator, closed: boolean): Promise<void> {
  sim.setProbeInput(closed);
  await vi.advanceTimersByTimeAsync(STATUS_REPORTS_MS);
}

function sentProbeMoves(sim: GrblSimulator): ReadonlyArray<string> {
  return sim.outbound().filter((line) => line.includes('G38.2'));
}

describe('touch-off proves the probe circuit before it seeks', () => {
  it('refuses to seek before a test touch, so a forgotten clip never moves the bit', async () => {
    const sim = await connect();
    expect(probeCircuitCheck(useLaserStore.getState())).toBe('untested');

    const result = await settle(useLaserStore.getState().probe(Z_REQUEST));

    expect(result.kind).toBe('preflight-failed');
    expect(result.kind === 'preflight-failed' && result.reason).toMatch(/Test the probe first/);
    expect(sentProbeMoves(sim)).toEqual([]);
    expect(useLaserStore.getState().probeBusy).toBe(false);
  });

  it('refuses while the probe input is closed, before GRBL would raise ALARM:4', async () => {
    const sim = await connect();
    await setProbeInput(sim, true);
    expect(probeCircuitCheck(useLaserStore.getState())).toBe('closed');

    const result = await settle(useLaserStore.getState().probe(Z_REQUEST));

    expect(result.kind === 'preflight-failed' && result.reason).toMatch(/probe input is closed/);
    expect(sentProbeMoves(sim)).toEqual([]);
  });

  it('probes after one touch and release, then asks for a new touch', async () => {
    const sim = await connect();
    await setProbeInput(sim, true);
    await setProbeInput(sim, false);
    expect(probeCircuitCheck(useLaserStore.getState())).toBe('tested');

    await expect(settle(useLaserStore.getState().probe(Z_REQUEST))).resolves.toEqual({
      kind: 'ok',
    });
    expect(sentProbeMoves(sim)).toHaveLength(2);

    // The cycle used the touch up: the next touch-off proves the lead again.
    expect(probeCircuitCheck(useLaserStore.getState())).toBe('untested');
    const retry = await settle(useLaserStore.getState().probe(Z_REQUEST));
    expect(retry.kind === 'preflight-failed' && retry.reason).toMatch(/Test the probe first/);
    expect(sentProbeMoves(sim)).toHaveLength(2);
  });

  it('counts a touch made in Alarm after ALARM:5, before the unlock', async () => {
    const sim = await connect();
    sim.triggerAlarm(5);
    await vi.advanceTimersByTimeAsync(STATUS_REPORTS_MS * 2);
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
    await setProbeInput(sim, true);
    await setProbeInput(sim, false);
    expect(probeCircuitCheck(useLaserStore.getState())).toBe('tested');
  });

  it('forgets the touch on a new controller session', async () => {
    const sim = await connect();
    await setProbeInput(sim, true);
    await setProbeInput(sim, false);
    expect(probeCircuitCheck(useLaserStore.getState())).toBe('tested');

    useLaserStore.setState((state) => ({
      controllerSessionEpoch: state.controllerSessionEpoch + 1,
    }));
    expect(probeCircuitCheck(useLaserStore.getState())).toBe('untested');
  });
});

// Controller audit v2 C2-P2-1 (ADR-375 Amendment 3): every probe cycle starts
// with `G54`, and GRBL's G54 is modal, so after a probe the controller is in
// G54 and `G10 L20 P0` wrote G54. The store kept the system it knew before
// (G55 here), so the next Frame "selected" G54 again, voided the fresh probe
// Work-Z and asked for Zero Z with the bit parked above the stock. Driven
// through the real store against the GRBL simulator, as the audit's repro was.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { DEFAULT_Z_PROBE_PARAMS, type ProbeRequest } from '../../core/controllers/grbl/probe';
import { normalizeFrameWorkCoordinateSystem } from '../laser/frame-controller-readiness';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { useLaserStore } from './laser-store';
import { markProbeCircuitTested } from './probe-test-touch.test-support';
import { resetStore } from './test-helpers';
import { isWorkZZeroEvidenceCurrent } from './work-z-zero-evidence';

const Z_REQUEST = { kind: 'z', params: DEFAULT_Z_PROBE_PARAMS } satisfies ProbeRequest;

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
    activeWcs: null,
    workOriginActive: false,
    workOriginSource: 'none',
    wcoCache: null,
    workZZeroEvidence: null,
    positionEvidenceSuppressed: false,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Advances the test clock until `promise` settles. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  for (let tick = 0; tick < 600 && !done; tick += 1) await vi.advanceTimersByTimeAsync(10);
  return tracked;
}

/** Stock GRBL with G55 selected from the Console, as a `$N` startup line would. */
async function connectInG55(): Promise<void> {
  const sim = createGrblSimulator();
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'grbl-v1.1' });
  await vi.advanceTimersByTimeAsync(1_200);
  await settle(useLaserStore.getState().sendConsoleCommand('G55'));
  // A Console command waits for the next status report before anything else.
  for (let tick = 0; tick < 50 && useLaserStore.getState().statusReport?.state !== 'Idle'; tick++)
    await vi.advanceTimersByTimeAsync(100);
  expect(useLaserStore.getState().activeWcs).toBe('G55');
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
}

function workZIsCurrent(): boolean {
  const laser = useLaserStore.getState();
  return isWorkZZeroEvidenceCurrent(laser.workZZeroEvidence, laser.workZReferenceEpoch);
}

describe('probing selects the program G54 and the store follows it', () => {
  it('keeps the probe Work-Z through the next Frame on a controller left in G55', async () => {
    await connectInG55();

    markProbeCircuitTested();
    await expect(settle(useLaserStore.getState().probe(Z_REQUEST))).resolves.toEqual({
      kind: 'ok',
    });
    expect(useLaserStore.getState().activeWcs).toBe('G54');
    expect(useLaserStore.getState().workZZeroEvidence?.source).toBe('probe');
    expect(workZIsCurrent()).toBe(true);

    // Frame finds G54 already active: no false "Controller was using G55"
    // warning, and the probe's Work-Z survives.
    await expect(settle(normalizeFrameWorkCoordinateSystem())).resolves.toEqual({ ok: true });
    await expect(settle(useLaserStore.getState().selectPrimaryWcsForFrame())).resolves.toEqual({
      kind: 'already-g54',
    });
    expect(useLaserStore.getState().workZZeroEvidence?.source).toBe('probe');
    expect(workZIsCurrent()).toBe(true);
    expect(useLaserStore.getState().log.join('\n')).not.toContain('Frame selected G54');
  });

  it('keeps the Work-Z that Zero Z records with its own G54', async () => {
    await connectInG55();

    await settle(useLaserStore.getState().zeroZHere());
    expect(useLaserStore.getState().activeWcs).toBe('G54');
    expect(useLaserStore.getState().workZZeroEvidence?.source).toBe('manual-zero');
    expect(workZIsCurrent()).toBe(true);

    await expect(settle(useLaserStore.getState().selectPrimaryWcsForFrame())).resolves.toEqual({
      kind: 'already-g54',
    });
    expect(workZIsCurrent()).toBe(true);
  });

  it('voids Work-Z measured in G55 when Set origin selects G54', async () => {
    await connectInG55();
    useLaserStore.setState((state) => ({
      workZZeroEvidence: {
        source: 'controller-readback',
        referenceEpoch: state.workZReferenceEpoch,
        activeWcs: 'G55',
      },
    }));

    await settle(useLaserStore.getState().setOriginHere());
    const laser = useLaserStore.getState();
    expect(laser.activeWcs).toBe('G54');
    expect(laser.workZZeroEvidence).toBeNull();
    expect(laser.log.join('\n')).toContain('Set work origin selected G54 (was G55)');
  });
});

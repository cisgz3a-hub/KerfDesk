// Controller audit 2, M-2 (ADR-375): the corner probe commits with G10 L20,
// which stores G54 = MPos - G92 - WPos (grbl gcode.c L550-L553). Run while a
// Set origin (G92) was active, it stored the corner shifted by that G92, which
// held only while the G92 did: the next reset clears G92 on stock GRBL (gc_init
// zeroes the parser state), and the work origin jumped by the G92 amount. The
// cycle now drops G92 (G92.1) just before its single G10 L20. Driven through
// the real store against the GRBL simulator, whose G10 L20 applies G92 too.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L550-L553
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L42-L44

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import {
  DEFAULT_PLATE_CENTER_OFFSET_X_MM,
  DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
  DEFAULT_SIDE_CLEARANCE_MM,
  DEFAULT_SIDE_DROP_MM,
  DEFAULT_Z_PROBE_PARAMS,
  type ProbeRequest,
} from '../../core/controllers/grbl/probe';
import { resolveJobPlacement } from '../job-placement';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

const USER_ORIGIN = { startFrom: 'user-origin', anchor: 'front-left' } as const;
const CORNER_REQUEST = {
  kind: 'corner',
  params: {
    ...DEFAULT_Z_PROBE_PARAMS,
    bitDiameterMm: 6.35,
    toolKind: 'end-mill',
    corner: 'front-left',
    plateCenterOffsetXmm: DEFAULT_PLATE_CENTER_OFFSET_X_MM,
    plateCenterOffsetYmm: DEFAULT_PLATE_CENTER_OFFSET_Y_MM,
    sideDropMm: DEFAULT_SIDE_DROP_MM,
    sideClearanceMm: DEFAULT_SIDE_CLEARANCE_MM,
  },
} satisfies ProbeRequest;
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

/** Connects to stock GRBL, jogs to (25, 15) and sets the origin there: G92 X25 Y15. */
async function connectWithSetOrigin(): Promise<GrblSimulator> {
  const sim = createGrblSimulator();
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'grbl-v1.1' });
  await vi.advanceTimersByTimeAsync(1_200);
  await settle(useLaserStore.getState().jog({ dx: 25, dy: 15, feed: 1_000 }));
  await vi.advanceTimersByTimeAsync(1_000);
  await settle(useLaserStore.getState().setOriginHere());
  expect(sim.state().g92).toEqual({ x: 25, y: 15, z: 0 });
  // The operator then moves to the plate.
  await settle(useLaserStore.getState().jog({ dx: 40, dy: 30, feed: 1_000 }));
  await vi.advanceTimersByTimeAsync(1_000);
  return sim;
}

/** The work offset the controller applies, G54 plus G92, as its report prints it. */
function appliedWorkOffset(sim: GrblSimulator): { x: number; y: number; z: number } {
  const zero = { x: 0, y: 0, z: 0 };
  const g54 = sim.state().g54 ?? zero;
  const g92 = sim.state().g92 ?? zero;
  const reported = (value: number): number => Number(value.toFixed(3));
  return {
    x: reported(g54.x + g92.x),
    y: reported(g54.y + g92.y),
    z: reported(g54.z + g92.z),
  };
}

/** Stop sends the soft reset, which clears G92 on stock GRBL. */
async function softReset(sim: GrblSimulator): Promise<void> {
  await settle(useLaserStore.getState().stopJob());
  expect(sim.outbound()).toContain('\x18');
  expect(sim.state().g92).toBeNull();
  await vi.advanceTimersByTimeAsync(3_000);
}

describe('touch-plate probing after Set origin here (M-2)', () => {
  it('stores the probed corner itself, so it survives the next reset', async () => {
    const sim = await connectWithSetOrigin();

    await expect(settle(useLaserStore.getState().probe(CORNER_REQUEST))).resolves.toEqual({
      kind: 'ok',
    });
    const probed = appliedWorkOffset(sim);
    // No temporary origin is left: the corner is a saved G54 origin.
    expect(useLaserStore.getState()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'g54-persistent',
    });

    await softReset(sim);
    expect(appliedWorkOffset(sim)).toEqual(probed);
    const laser = useLaserStore.getState();
    expect(laser.wcoCache).toEqual(probed);
    expect(resolveJobPlacement(USER_ORIGIN, laser)).toMatchObject({
      ok: true,
      preflightMotionOffset: { x: probed.x, y: probed.y },
    });
  });

  // Set origin here writes G92 X Y only, and G10 L20 works per axis, so the Z
  // cycle's stored Z never includes that G92; a G92.1 in it would drop the
  // operator's XY origin instead (probe.ts header).
  it('keeps the XY origin through a Z touch-off', async () => {
    const sim = await connectWithSetOrigin();

    await expect(settle(useLaserStore.getState().probe(Z_REQUEST))).resolves.toEqual({
      kind: 'ok',
    });
    expect(sim.state().g92).toEqual({ x: 25, y: 15, z: 0 });
    expect(useLaserStore.getState()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'g92',
    });
    const storedZ = sim.state().g54?.z;
    await softReset(sim);
    expect(sim.state().g54?.z).toBe(storedZ);
  });
});

// grblHAL keeps a G92 origin through a soft reset (controller audit 2026-09-25,
// the persistence lead in the report's Limits). At its default
// COMPATIBILITY_LEVEL 0 the reset clears the parser state only up to
// `g92_offset`, and a power-up reloads the stored offset unless $384 is set:
//   gcode.c:787  memset(&gc_state, 0, offsetof(parser_state_t, g92_offset));
//   gcode.c:833  if(sys.cold_start && !settings.flags.g92_is_volatile) { ...
//   https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L787
// Stock GRBL clears it (gcode.c gc_init memsets the whole parser state).
// KerfDesk forgets the origin at the reset on both, then follows the WCO of
// the first report after the banner (grblHAL report.c:309 zeroes the WCO
// counter), so a job placed afterwards uses the offset the controller applies.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { resolveJobPlacement } from '../job-placement';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

const GRBL_HAL_BANNER = "GrblHAL 1.1f ['$' or '$HELP' for help]";
const USER_ORIGIN = { startFrom: 'user-origin', anchor: 'front-left' } as const;

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
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function originThenReset(firmware: 'grblhal' | 'grbl') {
  const sim = createGrblSimulator(
    firmware === 'grblhal' ? { firmware: 'grblhal', firmwareBanner: GRBL_HAL_BANNER } : {},
  );
  await useLaserStore
    .getState()
    .connect(sim.adapter, { controllerKind: firmware === 'grblhal' ? 'grblhal' : 'grbl-v1.1' });
  await vi.advanceTimersByTimeAsync(1_200);
  await useLaserStore.getState().jog({ dx: 25, dy: 15, feed: 1_000 });
  await vi.advanceTimersByTimeAsync(2_000);
  const setOrigin = useLaserStore.getState().setOriginHere();
  await vi.advanceTimersByTimeAsync(1_000);
  await setOrigin;
  const stop = useLaserStore.getState().stopJob();
  await vi.advanceTimersByTimeAsync(20);
  expect(sim.outbound()).toContain('\x18');
  // Until the controller reports again, KerfDesk assumes nothing.
  expect(resolveJobPlacement(USER_ORIGIN, useLaserStore.getState()).ok).toBe(false);
  await vi.advanceTimersByTimeAsync(3_000);
  await stop;
  return sim;
}

describe('A G92 origin through a soft reset', () => {
  it('grblHAL keeps it, and User Origin follows the offset it still applies', async () => {
    const sim = await originThenReset('grblhal');
    expect(sim.state().g92).toEqual({ x: 25, y: 15, z: 0 });
    const laser = useLaserStore.getState();
    expect(laser).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'unknown',
      wcoCache: { x: 25, y: 15, z: 0 },
    });
    expect(resolveJobPlacement(USER_ORIGIN, laser)).toMatchObject({
      ok: true,
      preflightMotionOffset: { x: 25, y: 15 },
    });
  });

  it('stock GRBL clears it, and User Origin asks for Set origin again', async () => {
    const sim = await originThenReset('grbl');
    expect(sim.state().g92).toBeNull();
    const laser = useLaserStore.getState();
    expect(laser).toMatchObject({ workOriginActive: false, workOriginSource: 'none' });
    expect(resolveJobPlacement(USER_ORIGIN, laser).ok).toBe(false);
  });
});

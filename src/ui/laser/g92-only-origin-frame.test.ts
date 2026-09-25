// Origin workflows on the g92-only drivers (Marlin, Smoothieware) and the
// Frame's G54 normalization (controller audit 2026-09-25 CG-1, CG-2).
//
// CG-1  Smoothieware prints both MPos and WPos in every `?` report and never a
//       `WCO:` field (Kernel::get_query_string, Smoothieware edge 38e2cc08
//       src/libs/Kernel.cpp L206-L234 and L261-L285), so the work offset is
//       MPos - WPos of the same report (laser-status-position.ts). Marlin's M114
//       is the work position, and KerfDesk records the shift it writes
//       (host-recorded-origin.ts). Before, User Origin was refused forever on
//       both after Set origin.
// CG-2  The Frame sends no G54 to Marlin and keeps an origin that is still set
//       on the controller. On Marlin 2.1.2.8 with CNC_COORDINATE_SYSTEMS, G54 ->
//       select_coordinate_system(0) replaces position_shift with
//       coordinate_system[0] (gcode/geometry/G53-G59.cpp L33-L46), which erases
//       the operator's origin; stock builds answer "Unknown command". KerfDesk's
//       Marlin emitter strips G54 for this reason (marlin-inline-transform.ts).
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L177-L300
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/geometry/G53-G59.cpp#L33-L46
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L111

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMarlinSimulator,
  createSmoothieSimulator,
  type MarlinSimulator,
  type SmoothieSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { resolveLiveFramePlacement } from './camera-frame-placement';
import { normalizeFrameWorkCoordinateSystem } from './frame-controller-readiness';
import { currentWorkXy } from './frame-dispatch-support';
import { disconnectOnTestClock } from '../state/laser-disconnect-testing';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
    wcoCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
    activeWcs: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function settle<T>(pending: Promise<T>, maxMs = 5_000): Promise<T> {
  let done = false;
  const tracked = pending.finally(() => {
    done = true;
  });
  for (let t = 0; t < maxMs / 10 && !done; t += 1) await pump(10);
  return tracked;
}

async function connectSmoothieIdle(): Promise<SmoothieSimulator> {
  const sim = createSmoothieSimulator();
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

async function connectMarlinIdle(): Promise<MarlinSimulator> {
  const sim = createMarlinSimulator();
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

describe('CG-1: User Origin on a g92-only controller', () => {
  it('Smoothieware: a Set origin that succeeded lets a User Origin Frame resolve its placement', async () => {
    const sim = await connectSmoothieIdle();
    await settle(useLaserStore.getState().setOriginHere());
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    // Upstream report after `G92 X0 Y0` with the head at machine X110 Y60: both
    // positions are printed, no WCO field.
    sim.port.emitLine(
      '<Idle|MPos:110.0000,60.0000,0.0000|WPos:0.0000,0.0000,0.0000|F:4000.0,100.0>',
    );
    await pump(1);
    useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });

    const placement = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    // controller has not reported where it is yet. ...'] }
    expect(placement.ok, JSON.stringify(placement)).toBe(true);
  });
});

describe('CG-1: Smoothieware offset left on the board', () => {
  it('Smoothieware: an Absolute Frame compensates the offset the board reports (MPos - WPos)', async () => {
    const sim = await connectSmoothieIdle();
    // A board that kept a G92 from an earlier session: Smoothieware keeps
    // g92_offset through halt/M999 and host reconnects (Robot.cpp only resets it
    // at boot or on G92.1, L123/L627). Its report shows the offset.
    sim.port.emitLine(
      '<Idle|MPos:110.0000,60.0000,0.0000|WPos:0.0000,0.0000,0.0000|F:4000.0,100.0>',
    );
    await pump(1);
    useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
    const placement = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    // GRBL's WCO gets exactly this compensation (resolveAbsolute). Before the
    // fix: { ok: true } with no offset, so the Absolute job ran 110/60 mm off.
    expect(placement, JSON.stringify(placement)).toMatchObject({
      ok: true,
      preflightMotionOffset: { x: 110, y: 60 },
    });
  });
});

describe('CG-1: Marlin after Set origin', () => {
  it('Marlin: at least one placement mode can still Frame once an origin is set', async () => {
    await connectMarlinIdle();
    await settle(useLaserStore.getState().setOriginHere());
    // A later Frame in the same session skips the G54 normalization (CG-2).
    useLaserStore.setState({ activeWcs: 'G54' });
    await pump(1_200); // a fresh M114 report after the G92
    const laser = useLaserStore.getState();
    expect(laser.workOriginActive).toBe(true);
    const outcomes = (
      ['absolute', 'current-position', 'user-origin', 'verified-origin'] as const
    ).map((startFrom) => {
      useStore.setState({ jobPlacement: { startFrom, anchor: 'front-left' } });
      const placement = resolveLiveFramePlacement(useStore.getState(), laser);
      // dispatchPreparedFrame refuses with FRAME_WORK_POSITION_UNKNOWN_MESSAGE
      // when it cannot bind the Frame's return point.
      const framePosition = currentWorkXy(laser);
      return { startFrom, placement, framePosition };
    });
    expect(
      outcomes.some((o) => o.placement.ok && o.framePosition !== undefined),
      JSON.stringify(outcomes),
    ).toBe(true);
  });
});

describe('CG-2: the Frame G54 normalization on g92-only controllers', () => {
  it('Marlin: preparing a Frame after Set origin does not write G54 or forget the origin', async () => {
    const sim = await connectMarlinIdle();
    await settle(useLaserStore.getState().setOriginHere());
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().activeWcs).toBeNull(); // never read on Marlin

    await settle(normalizeFrameWorkCoordinateSystem());
    // G92 origin from its boot-time machine space) ...
    expect(sim.outbound()).not.toContain('G54\n');
    // ... and the store forgets the origin it just set.
    expect(useLaserStore.getState().workOriginActive).toBe(true);
  });

  it('Smoothieware: preparing a Frame after Set origin keeps the origin the controller still holds', async () => {
    await connectSmoothieIdle();
    await settle(useLaserStore.getState().setOriginHere());
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    useStore.setState({ jobPlacement: { startFrom: 'verified-origin', anchor: 'front-left' } });
    expect(resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState())).toMatchObject({
      ok: true,
    });

    await settle(normalizeFrameWorkCoordinateSystem());

    // Smoothieware keeps G92 separate from the G54-G59 selection, so the origin is
    // still set on the controller. Before the fix: workOriginActive=false and
    // the Verified Origin Frame was refused with "Click 'Set origin here' first".
    const after = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    expect(after.ok, JSON.stringify(after)).toBe(true);
    expect(useLaserStore.getState().workOriginActive).toBe(true);
  });

  it('Smoothieware: an Absolute Frame after the normalization still compensates the G92 the board keeps', async () => {
    const sim = await connectSmoothieIdle();
    await settle(useLaserStore.getState().jog({ dx: 110, dy: 60, feed: 6_000 }));
    await pump(2_000);
    await settle(useLaserStore.getState().setOriginHere());
    await pump(1_000);
    expect(useLaserStore.getState().statusReport).toMatchObject({
      mPos: { x: 110, y: 60 },
      wPos: { x: 0, y: 0 },
    });
    const placement = { startFrom: 'absolute', anchor: 'front-left' } as const;
    useStore.setState({ jobPlacement: placement });

    await settle(normalizeFrameWorkCoordinateSystem());
    await pump(1_000);

    // `$G` reads G54 back (SimpleShell.cpp L218-L222), so no G54 is written,
    // and the offset the board still applies is compensated as before.
    expect(sim.outbound()).toContain('$G\n');
    expect(sim.outbound()).not.toContain('G54\n');
    const after = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    expect(after, JSON.stringify(after)).toMatchObject({
      ok: true,
      preflightMotionOffset: { x: 110, y: 60 },
    });
  });
});

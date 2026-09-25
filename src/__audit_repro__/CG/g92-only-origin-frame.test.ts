// Audit CG-1 / CG-2 repro: origin workflows on the g92-only drivers (Marlin,
// Smoothieware) and the Frame's G54 "normalization".
//
// Correct behaviour:
// CG-1  After "Set origin here" succeeds on Smoothieware, a User Origin Frame must be
//       able to resolve its placement. Smoothieware prints BOTH MPos and WPos in every
//       `?` report, idle or running (Kernel::get_query_string, Smoothieware edge
//       38e2cc08 src/libs/Kernel.cpp L206-L234 and L261-L285), so the work offset is
//       MPos - WPos of the same report. It never prints a `WCO:` field.
//       KerfDesk's resolveUserOrigin requires wcoCache/report.wco, which a g92-only
//       controller never supplies, so User Origin is refused forever with
//       "The work origin is set, but the controller has not reported where it is yet".
// CG-2  The Frame must not send `G54` to Marlin, and must not forget an origin that is
//       still set on the controller. KerfDesk never reads the active WCS on drivers
//       without a settings query (activeWcs stays null), so every first Frame of a
//       session runs selectPrimaryWcsForFrame(): it writes `G54` and applies the Console
//       'coordinates-all' effect (workOriginActive=false, workOriginSource='none').
//       On Marlin 2.1.2.8 with CNC_COORDINATE_SYSTEMS (the driver's documented origin
//       contract) the boot state is active_coordinate_system = -1
//       (Marlin/src/gcode/gcode.cpp L111), a G92 made there only changes position_shift
//       (gcode/geometry/G92.cpp L98-L128), and G54 -> select_coordinate_system(0)
//       replaces position_shift with coordinate_system[0]
//       (gcode/geometry/G53-G59.cpp L33-L46), i.e. it erases the operator's origin.
//       KerfDesk's own Marlin emitter strips G54 for exactly this reason
//       (src/core/output/marlin-inline-transform.ts withoutGrblWorkspacePreamble).
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
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';
import { resolveLiveFramePlacement } from '../../ui/laser/camera-frame-placement';
import { normalizeFrameWorkCoordinateSystem } from '../../ui/laser/frame-controller-readiness';
import { currentWorkXy } from '../../ui/laser/frame-dispatch-support';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
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

    // Fails today: { ok: false, messages: ['The work origin is set, but the
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
    // GRBL's WCO gets exactly this compensation (resolveAbsolute). Fails today:
    // { ok: true } with no offset, so the Absolute job runs 110/60 mm off.
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
    const outcomes = (['absolute', 'current-position', 'user-origin', 'verified-origin'] as const).map(
      (startFrom) => {
        useStore.setState({ jobPlacement: { startFrom, anchor: 'front-left' } });
        const placement = resolveLiveFramePlacement(useStore.getState(), laser);
        // dispatchPreparedFrame refuses with FRAME_WORK_POSITION_UNKNOWN_MESSAGE
        // when it cannot bind the Frame's return point.
        const framePosition = currentWorkXy(laser);
        return { startFrom, placement, framePosition };
      },
    );
    // Fails today: absolute and current-position need a WCO, user-origin needs a
    // WCO, and verified-origin resolves but has no work position (M114 carries
    // no WCO and workOriginActive makes reportedWorkPositionMm return null).
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

    // Fails today: `G54\n` is written (erasing a CNC_COORDINATE_SYSTEMS build's
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
    expect(
      resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState()),
    ).toMatchObject({ ok: true });

    await settle(normalizeFrameWorkCoordinateSystem());

    // Smoothieware keeps G92 separate from the G54-G59 selection, so the origin is
    // still set on the controller. Fails today: workOriginActive=false and the
    // Verified Origin Frame is refused with "Click 'Set origin here' first".
    const after = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    expect(after.ok, JSON.stringify(after)).toBe(true);
    expect(useLaserStore.getState().workOriginActive).toBe(true);
  });
});

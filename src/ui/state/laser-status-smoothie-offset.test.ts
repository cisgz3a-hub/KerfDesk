// Smoothieware keeps a G92 origin through a reconnect, halt, M999 and Home, and
// reports the work offset only as the difference of MPos and WPos. KerfDesk now
// derives the offset from that difference (laser-status-position.ts), so
// Absolute placement compensates it instead of running displaced (controller
// audit 2026-09-25 SM-1, CG-1).
//
// Upstream evidence (Smoothieware edge 38e2cc08):
// - Robot::on_gcode_received is the only place g92_offset changes (G92, G92.1,
//   G92.2, G92.3, G92.4): src/modules/robot/Robot.cpp L624-L662.
// - Robot registers only ON_GCODE_RECEIVED (Robot.cpp L133), so ON_HALT (Ctrl-X,
//   kill, limit, M999's ON_HALT(1)) never touches g92_offset; Kernel::call_event
//   only re-syncs positions (src/libs/Kernel.cpp L359-L381).
// - Endstops homing resets axis positions, not g92_offset
//   (src/modules/tools/endstops/Endstops.cpp L962-L973).
// - A USB re-attach does not reset the MCU (USBSerial::on_main_loop only prints
//   "Smoothie\r\nok", src/libs/USBDevice/USBSerial/USBSerial.cpp L328-L345).
// - Every `?` report prints MPos and WPos (WPos = mcs2wcs(MPos), which adds
//   g92_offset) and never a WCO field: src/libs/Kernel.cpp L261-L287,
//   Robot.cpp L448-L456.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L624-L662
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L261-L287
//
// The simulator executes `G92 X0 Y0` as a move to X0 Y0 and always reports
// WPos = MPos, so these tests emit the report the real firmware prints.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { resolveLiveFramePlacement } from '../laser/camera-frame-placement';
import { disconnectOnTestClock } from './laser-disconnect-testing';

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
    homingState: 'unknown',
    safetyNotice: null,
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

function absolutePlacement() {
  useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
  return resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
}

/** Absolute must compensate the offset the board reports, or refuse. */
function expectOffsetHonoured(
  placement: ReturnType<typeof absolutePlacement>,
  offset: { readonly x: number; readonly y: number },
): void {
  if (!placement.ok) return;
  expect(placement.preflightMotionOffset, JSON.stringify(placement)).toEqual(offset);
}

describe('a G92 origin Smoothieware still holds', () => {
  it('is honoured by Absolute placement after a reconnect (the board kept its G92)', async () => {
    const sim = await connectSmoothieIdle();
    // Real report of a board whose origin was set at machine X110 Y60 before this
    // connection (by KerfDesk in an earlier session, or by another host).
    sim.port.emitLine(
      '<Idle|MPos:110.0000,60.0000,0.0000|WPos:0.0000,0.0000,0.0000|F:4000.0,100.0>',
    );
    await pump(1);
    // The offset is re-learned from MPos - WPos, so the origin is known again.
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    expect(useLaserStore.getState().wcoCache).toEqual({ x: 110, y: 60, z: 0 });

    // Before the fix: { ok: true } with no offset, so the job ran 110/60 mm away
    // from the drawn Absolute coordinates.
    expectOffsetHonoured(absolutePlacement(), { x: 110, y: 60 });
  });

  it('is re-learned after a halt, Unlock and Home, so Absolute is not displaced', async () => {
    const sim = await connectSmoothieIdle();
    await settle(useLaserStore.getState().setOriginHere());
    expect(useLaserStore.getState()).toMatchObject({
      workOriginActive: true,
      workOriginSource: 'g92',
    });

    // Any halt (Abort's Ctrl-X, kill button, limit). Smoothieware reports Alarm.
    sim.triggerHalt();
    await pump(1_100);
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');

    await settle(useLaserStore.getState().unlockAlarm()); // M999
    await pump(1_100); // next `?` poll: Idle
    await settle(useLaserStore.getState().home()); // $H: Endstops keeps g92_offset
    expect(useLaserStore.getState().homingState).toBe('confirmed');

    // Real report after homing to machine 0,0 with the G92 set at X110 Y60 still
    // applied: WPos = MPos + g92_offset = MPos - (110, 60).
    sim.port.emitLine(
      '<Idle|MPos:0.0000,0.0000,0.0000|WPos:-110.0000,-60.0000,0.0000|F:4000.0,100.0>',
    );
    await pump(1);

    // The board still applies the G92, and KerfDesk knows it again.
    expect(useLaserStore.getState().workOriginActive).toBe(true);
    // Work offset = MPos - WPos = (110, 60), the G92 the operator set before the
    // halt. Before the fix: { ok: true } with no offset.
    expectOffsetHonoured(absolutePlacement(), { x: 110, y: 60 });
  });
});

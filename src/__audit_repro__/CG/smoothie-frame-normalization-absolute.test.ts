// Audit CG-2 repro (Smoothieware, Absolute placement): the Frame's G54
// "normalization" makes KerfDesk forget a G92 origin that Smoothieware keeps, and
// an Absolute Frame then resolves with no offset.
//
// activeWcs is never read on Smoothieware (modalStateQuery null), so the first
// Frame of a session runs selectPrimaryWcsForFrame(): it writes G54 and applies
// the Console 'coordinates-all' effect (workOriginActive=false, source 'none',
// wcoCache=null). prepareFrameContext runs this before the placement is resolved
// (use-frame-action.ts), and waitForAbsoluteFrameOffset only waits for an offset
// on 'g92-and-g10' drivers (frame-position-readiness.ts needsAbsoluteFrameOffset),
// so nothing re-learns the offset on Smoothieware.
//
// Upstream: G54 only sets current_wcs; the G92 offset is separate and survives it
// (Robot.cpp L612-L617, L624-L662), and every `?` report prints MPos and
// WPos = mcs2wcs(MPos) (Robot.cpp L449-L455, Kernel.cpp L261-L285).
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L612-L662
//
// Before the normalization an Absolute Frame is refused (custom origin, no WCO:
// CG-1); after it, the same Absolute placement resolves {ok:true} with no offset,
// so the Frame and the job are driven through the retained G92 and land displaced
// by the origin offset. Correct behaviour: the Absolute placement after the
// normalization is refused or compensated by the offset the board still applies.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';
import { resolveLiveFramePlacement } from '../../ui/laser/camera-frame-placement';
import { normalizeFrameWorkCoordinateSystem } from '../../ui/laser/frame-controller-readiness';
import { waitForAbsoluteFrameOffset } from '../../ui/laser/frame-position-readiness';
import { createUpstreamSmoothie } from './upstream-smoothie-fake';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    wcoCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
    activeWcs: null,
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function settle<T>(pending: Promise<T>): Promise<T> {
  let done = false;
  const tracked = pending.finally(() => {
    done = true;
  });
  for (let t = 0; t < 1_000 && !done; t += 1) await pump(10);
  return tracked;
}

describe('CG-2 on Smoothieware: Frame normalization and Absolute placement', () => {
  it('does not turn a live G92 origin into an unshifted Absolute Frame', async () => {
    const board = createUpstreamSmoothie({ headMpos: { x: 110, y: 60 } });
    useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
    await useLaserStore.getState().connect(board.adapter, { controllerKind: 'smoothieware' });
    await pump(2_500);
    await settle(useLaserStore.getState().setOriginHere());
    await pump(1_000);
    expect(useLaserStore.getState().statusReport).toMatchObject({
      mPos: { x: 110, y: 60 },
      wPos: { x: 0, y: 0 },
    });
    const placement = { startFrom: 'absolute', anchor: 'front-left' } as const;
    useStore.setState({ jobPlacement: placement });
    expect(resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState()).ok).toBe(false);

    const normalization = await settle(normalizeFrameWorkCoordinateSystem());
    const waited = await settle(waitForAbsoluteFrameOffset(placement));
    await pump(1_000);
    const report = useLaserStore.getState().statusReport;
    const after = resolveLiveFramePlacement(useStore.getState(), useLaserStore.getState());
    // The board still applies its G92: MPos 110,60 / WPos 0,0 in every report.
    expect(report).toMatchObject({ mPos: { x: 110, y: 60 }, wPos: { x: 0, y: 0 } });
    // Fails today: normalization {ok:true}, no offset wait, and Absolute resolves
    // {ok:true} with no preflightMotionOffset (a bed point is driven 110/60 mm off).
    const compensated =
      after.ok && after.preflightMotionOffset?.x === 110 && after.preflightMotionOffset?.y === 60;
    expect(
      !after.ok || compensated,
      JSON.stringify({ normalization, waited, after, outbound: board.outbound().slice(-3) }),
    ).toBe(true);
  });
});

// After "Set origin here" on Marlin, User Origin and Current Position resolve
// (controller audit 2026-09-25 MA-2). M114 prints the logical position, already
// in the G92-shifted frame (current_position.asLogical(), motion.cpp
// report_logical_position), and never a work offset, so KerfDesk records the
// shift it writes itself (host-recorded-origin.ts). Before, Set origin left
// `wcoCache: null` and every placement that needs the origin's location was
// refused forever: User Origin is the default for a no-homing profile, and the
// Generic Marlin starter has homing off.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { defaultJobPlacementForDevice, resolveJobPlacement } from '../job-placement';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    workOriginActive: false,
    workOriginSource: 'none',
    wcoCache: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Marlin Set origin and the placements that follow it', () => {
  it('the Generic Marlin starter defaults to User Origin placement', () => {
    const marlin = profileCatalogEntryById('generic-marlin-laser')?.profile;
    expect(marlin?.homing.enabled).toBe(false);
    expect(marlin === undefined ? null : defaultJobPlacementForDevice(marlin).startFrom).toBe(
      'user-origin',
    );
  });

  it('User Origin and Current Position resolve after Set origin here', async () => {
    const sim = createMarlinSimulator();
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(1_200);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    await useLaserStore.getState().jog({ dx: 25, dy: 15, feed: 1_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    const setOrigin = useLaserStore.getState().setOriginHere();
    await vi.advanceTimersByTimeAsync(500);
    await setOrigin;
    expect(sim.outbound()).toContain('G92 X0 Y0\n');
    // Let many further M114 polls arrive: none carries a WCO.
    await vi.advanceTimersByTimeAsync(10_000);

    const laser = useLaserStore.getState();
    expect(laser.workOriginActive).toBe(true);
    // KerfDesk recorded the shift it wrote at the jogged position (MA-2).
    expect(laser.wcoCache).toEqual({ x: 25, y: 15, z: 0 });

    const userOrigin = resolveJobPlacement(
      { startFrom: 'user-origin', anchor: 'front-left' },
      laser,
    );
    const current = resolveJobPlacement(
      { startFrom: 'current-position', anchor: 'front-left' },
      laser,
    );
    // Before the fix both were refused, User Origin with a message that asked
    // the operator to wait for a report Marlin never sends.
    expect(userOrigin.ok).toBe(true);
    expect(current.ok).toBe(true);
  });
});

// Audit track MA (Marlin), finding MA-2: after "Set origin here" on Marlin,
// User Origin and Current Position placement are refused forever.
//
// Marlin's driver offers Set origin (`setOriginHere: 'G92 X0 Y0'`,
// capabilities.wcs 'g92-only'). Marlin never reports a work-coordinate offset:
// M114 prints one position, the LOGICAL one (current_position.asLogical(),
// motion.cpp report_logical_position), i.e. already in the G92-shifted frame
// the job's G-code runs in. KerfDesk's parser files that value as MPos with
// `wco: null` (core/controllers/marlin/response.ts), and Set origin records
// `workOriginActive: true, wcoCache: null` (laser-origin-actions.ts
// transientXyOriginPatch, because no prior WCO exists). From then on
// job-placement.ts refuses:
//  - User Origin: CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE ("the controller has
//    not reported where it is yet. Wait a moment and try again") — Marlin never
//    will, so waiting or re-setting the origin cannot help;
//  - Current Position: "needs a live machine position and work-coordinate offset";
//  - Absolute: ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE.
// User Origin is the default placement for a no-homing profile
// (defaultJobPlacementForDevice), and the Generic Marlin starter profile has
// homing disabled, so this is the default Marlin workflow. Only Verified Origin
// still resolves.
//
// Correct behaviour: with an origin set by KerfDesk's own G92 on Marlin, User
// Origin and Current Position resolve (the M114 X/Y are the work position the
// program runs in), or the UI does not offer a placement that can never resolve.
//
// Upstream: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/motion.cpp#L192-L212
//           (M114 prints rpos.asLogical()), G92.cpp#L100-L112 (G92 shifts the
//           workspace via position_shift, so the logical position becomes the
//           given value).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import {
  CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE,
  defaultJobPlacementForDevice,
  resolveJobPlacement,
} from '../../ui/job-placement';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

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

describe('MA-2: Marlin Set origin makes User Origin / Current Position unresolvable', () => {
  it('the Generic Marlin starter defaults to User Origin placement', () => {
    const marlin = profileCatalogEntryById('generic-marlin-laser')?.profile;
    expect(marlin?.homing.enabled).toBe(false);
    expect(marlin === undefined ? null : defaultJobPlacementForDevice(marlin).startFrom).toBe(
      'user-origin',
    );
  });

  it('User Origin resolves after Set origin here (it is refused on current code)', async () => {
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
    // Let many further M114 polls arrive: nothing Marlin sends will ever carry a WCO.
    await vi.advanceTimersByTimeAsync(10_000);

    const laser = useLaserStore.getState();
    expect(laser.workOriginActive).toBe(true);
    expect(laser.wcoCache).toBeNull();

    const userOrigin = resolveJobPlacement({ startFrom: 'user-origin', anchor: 'front-left' }, laser);
    const current = resolveJobPlacement(
      { startFrom: 'current-position', anchor: 'front-left' },
      laser,
    );
    // Current code: both refused; User Origin with a message that asks the
    // operator to wait for a report Marlin never sends.
    expect(userOrigin.ok ? null : userOrigin.messages).not.toContain(
      CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE,
    );
    expect(userOrigin.ok).toBe(true);
    expect(current.ok).toBe(true);
  });
});

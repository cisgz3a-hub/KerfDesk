// Audit track MA (Marlin), finding MA-3: Abort on Marlin records "no work
// origin" although nothing reset the controller's G92 offset.
//
// runStopJob (laser-job-actions.ts) applies originUnknownAfterControllerReset
// on every Abort. For a 'g92' origin that patch is `workOriginActive: false,
// workOriginSource: 'none'`. On GRBL that follows the soft reset Abort sends.
// Marlin has no reset byte (driver.realtime.softReset === null); Abort only
// stops sending and queues `M5 I` + `M107`, which do not touch the workspace
// offset (M3-M5.cpp, M106_M107.cpp). G92's position_shift stays in force until
// G92.1 (CNC_COORDINATE_SYSTEMS builds) or a reboot (G92.cpp). KerfDesk then
// resolves Absolute placement with no offset while Marlin still interprets the
// program's coordinates in the shifted (logical) frame, so the job and its
// Frame run displaced by the old origin from where the canvas shows them.
//
// Correct behaviour: after an Abort that did not reset the controller, the
// recorded origin stays 'g92' (or becomes 'unknown'), never 'none'.
//
// Upstream: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/geometry/G92.cpp#L60-L112
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M3-M5.cpp#L142-L154

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { resolveJobPlacement } from '../../ui/job-placement';
import { useLaserStore } from '../../ui/state/laser-store';
import { startTestLaserJob } from '../../ui/state/laser-test-start-helpers';
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

describe('MA-3: Marlin Abort forgets a G92 origin the firmware still applies', () => {
  it('keeps the G92 origin record across an Abort that sent no reset', async () => {
    const sim = createMarlinSimulator({ motionMs: 50 });
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(1_200);

    const setOrigin = useLaserStore.getState().setOriginHere();
    await vi.advanceTimersByTimeAsync(500);
    await setOrigin;
    expect(useLaserStore.getState().workOriginSource).toBe('g92');

    const job = Array.from({ length: 40 }, (_, i) => `G1 X${i} Y1 F600 S200`).join('\n');
    await startTestLaserJob(job, { streamingMode: 'ping-pong' });
    await vi.advanceTimersByTimeAsync(30);
    await useLaserStore.getState().stopJob();
    await vi.advanceTimersByTimeAsync(2_000);

    // No reset byte went out: the controller's G92 offset is untouched.
    expect(sim.outbound()).not.toContain('\x18');
    expect(sim.outbound().some((write) => /^G92\.1\b/m.test(write))).toBe(false);

    const laser = useLaserStore.getState();
    // Current code: 'none' / false — the app now resolves Absolute with no
    // offset while Marlin still runs every coordinate in the G92-shifted frame.
    expect(laser.workOriginSource).not.toBe('none');
    expect(laser.workOriginActive).toBe(true);
    expect(resolveJobPlacement({ startFrom: 'absolute', anchor: 'front-left' }, laser)).not.toEqual(
      { ok: true },
    );
  });
});

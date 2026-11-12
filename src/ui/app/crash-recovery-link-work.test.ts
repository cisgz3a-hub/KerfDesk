// The crash screen's ABORT during a controller-link job (ADR-705 Amendment 6,
// code quality audit C2 D4-P2-2): a render crash unmounts every panel and the
// Live Motion bars, so the crash screen must see the link's work and stop it
// with the link's own stop.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { reportLinkMachineWork, resetLinkMachineWorkForTests } from '../state/link-machine-work';
import { machineSoftwareAbort } from './crash-recovery';

const initialLaser = useLaserStore.getState();

afterEach(() => {
  resetLinkMachineWorkForTests();
  useLaserStore.setState(initialLaser);
});

describe('machineSoftwareAbort with a link job', () => {
  it('offers ABORT and sends the link stop when the laser store runs nothing', async () => {
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({ streamer: null, motionOperation: null, stopJob });
    expect(machineSoftwareAbort.isMotionLive()).toBe(false);
    const abort = vi.fn(async () => undefined);
    reportLinkMachineWork('lihuiyu-usb', {
      controller: 'K40',
      activity: 'running',
      advisories: [],
      abort,
    });
    expect(machineSoftwareAbort.isMotionLive()).toBe(true);
    await machineSoftwareAbort.trigger();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(stopJob).not.toHaveBeenCalled();
  });
});

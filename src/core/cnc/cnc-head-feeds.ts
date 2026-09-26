import type { DeviceProfile } from '../devices';
import type { CncMachineConfig, CncMachineParams, MachineConfig } from '../scene';

type SharedFeeds = Pick<DeviceProfile, 'maxFeed' | 'framingFeedMmPerMin'>;
type CncFeedParams = Pick<CncMachineParams, 'maxFeedMmPerMin' | 'framingFeedMmPerMin'>;

// Laser and CNC share one machine (bed, origin, homing, controller) but not
// their speeds: the device profile's Max feed and Frame speed are the laser's,
// and CNC keeps its own on the machine params. A CNC setup saved before the
// split has none yet, so the shared device values still apply to it.
export function cncMaxFeedMmPerMin(
  device: Pick<DeviceProfile, 'maxFeed'>,
  params: CncFeedParams,
): number {
  return params.maxFeedMmPerMin ?? device.maxFeed;
}

export function cncFramingFeedMmPerMin(
  device: Pick<DeviceProfile, 'framingFeedMmPerMin'>,
  params: CncFeedParams,
): number {
  return params.framingFeedMmPerMin ?? device.framingFeedMmPerMin;
}

// The device profile as a CNC job sees it: every shared field unchanged, with
// the router's own feed ceiling and Frame speed in place of the laser's.
export function cncHeadDevice<T extends SharedFeeds>(device: T, params: CncFeedParams): T {
  const maxFeed = cncMaxFeedMmPerMin(device, params);
  const framingFeedMmPerMin = cncFramingFeedMmPerMin(device, params);
  if (maxFeed === device.maxFeed && framingFeedMmPerMin === device.framingFeedMmPerMin) {
    return device;
  }
  return { ...device, maxFeed, framingFeedMmPerMin };
}

// The device as the project's active head sees it: the laser reads the device
// profile as is, CNC reads it with its own Max feed and Frame speed.
export function deviceForActiveHead<T extends SharedFeeds>(
  device: T,
  machine: MachineConfig | undefined,
): T {
  return machine?.kind === 'cnc' ? cncHeadDevice(device, machine.params) : device;
}

// Freeze CNC's speeds on its own params the first time a CNC setup is made or
// opened, so editing the laser's Max feed later never moves the router's.
export function cncParamsWithOwnFeeds<T extends CncFeedParams>(params: T, device: SharedFeeds): T {
  if (params.maxFeedMmPerMin !== undefined && params.framingFeedMmPerMin !== undefined) {
    return params;
  }
  return {
    ...params,
    maxFeedMmPerMin: cncMaxFeedMmPerMin(device, params),
    framingFeedMmPerMin: cncFramingFeedMmPerMin(device, params),
  };
}

export function cncMachineWithOwnFeeds(
  machine: CncMachineConfig,
  device: SharedFeeds,
): CncMachineConfig {
  const params = cncParamsWithOwnFeeds(machine.params, device);
  return params === machine.params ? machine : { ...machine, params };
}

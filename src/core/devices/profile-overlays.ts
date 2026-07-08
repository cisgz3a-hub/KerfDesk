import type { ControllerKind, DeviceProfile } from './device-profile';

export type ProfileControllerFactsInput = {
  readonly profile: DeviceProfile;
  readonly current: DeviceProfile;
  readonly detectedSettings: Partial<DeviceProfile> | null;
  readonly controllerSettings: Partial<DeviceProfile> | null;
  readonly detectedControllerKind: ControllerKind | null;
  readonly hasControllerRead: boolean;
};

export function profileWithControllerFacts(args: ProfileControllerFactsInput): DeviceProfile {
  const framingFeedMmPerMin = Math.max(
    args.current.framingFeedMmPerMin,
    args.profile.framingFeedMmPerMin,
  );
  const machinePatch = {
    ...(args.hasControllerRead ? machineReportedProfilePatch(args.current) : {}),
    ...machineReportedProfilePatch(args.controllerSettings),
    ...machineReportedProfilePatch(args.detectedSettings),
  };
  const controllerKind =
    args.detectedControllerKind ??
    (args.hasControllerRead ? args.current.controllerKind : undefined);
  return {
    ...args.profile,
    ...machinePatch,
    ...(args.hasControllerRead ? { framingFeedMmPerMin } : {}),
    ...(controllerKind === undefined ? {} : { controllerKind }),
  };
}

export function machineReportedProfilePatch(
  source: Partial<DeviceProfile> | null,
): Partial<DeviceProfile> {
  if (source === null) return {};
  return {
    ...(source.bedWidth === undefined ? {} : { bedWidth: source.bedWidth }),
    ...(source.bedHeight === undefined ? {} : { bedHeight: source.bedHeight }),
    ...(source.maxFeed === undefined ? {} : { maxFeed: source.maxFeed }),
    ...(source.maxPowerS === undefined ? {} : { maxPowerS: source.maxPowerS }),
    ...(source.minPowerS === undefined ? {} : { minPowerS: source.minPowerS }),
    ...(source.laserModeEnabled === undefined ? {} : { laserModeEnabled: source.laserModeEnabled }),
    ...(source.accelMmPerSec2 === undefined ? {} : { accelMmPerSec2: source.accelMmPerSec2 }),
    ...(source.junctionDeviationMm === undefined
      ? {}
      : { junctionDeviationMm: source.junctionDeviationMm }),
    ...(source.zTravelMm === undefined ? {} : { zTravelMm: source.zTravelMm }),
  };
}

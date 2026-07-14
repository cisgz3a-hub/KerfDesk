import {
  controllerCompatibleProfile,
  type ControllerProfileCorrection,
} from './controller-profile-compatibility';
import type { DeviceProfile } from './device-profile';

export type ProfileControllerFactMergeInput = {
  readonly profile: DeviceProfile;
  readonly current: DeviceProfile;
  readonly detectedSettings: Partial<DeviceProfile> | null;
  readonly controllerSettings: Partial<DeviceProfile> | null;
  readonly detectedControllerKind: DeviceProfile['controllerKind'] | null;
  readonly lastSettingsReadAt: number | null;
};

export type ProfileControllerFactMergeResult = {
  readonly profile: DeviceProfile;
  readonly corrections: ReadonlyArray<ControllerProfileCorrection>;
};

export function profileWithControllerFacts(args: ProfileControllerFactMergeInput): DeviceProfile {
  return profileWithControllerFactsResult(args).profile;
}

export function profileWithControllerFactsResult(
  args: ProfileControllerFactMergeInput,
): ProfileControllerFactMergeResult {
  const controllerRead = args.lastSettingsReadAt !== null;
  const framingFeedMmPerMin = Math.max(
    args.current.framingFeedMmPerMin,
    args.profile.framingFeedMmPerMin,
  );
  const machinePatch = {
    ...(controllerRead ? machineReportedProfilePatch(args.current) : {}),
    ...(controllerRead ? machineReportedProfilePatch(args.controllerSettings) : {}),
    ...(controllerRead ? machineReportedProfilePatch(args.detectedSettings) : {}),
  };
  const controllerKind =
    args.detectedControllerKind ?? (controllerRead ? args.current.controllerKind : undefined);
  const merged = {
    ...args.profile,
    ...machinePatch,
    ...(controllerRead ? { framingFeedMmPerMin } : {}),
  };
  return controllerCompatibleProfile(merged, controllerKind ?? merged.controllerKind);
}

function machineReportedProfilePatch(
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

import type { DeviceProfile } from '../../core/devices';
import type { MotionLimits } from '../../core/gcode-time';
import { laserPowerControlForDevice, type BuildRenderModelOptions } from '../../core/gcode-view';
import type { Project } from '../../core/scene';

/**
 * The kinematics and calibration the Inspector ETA plans against (ADR-425).
 * Plain data so it crosses to the parse worker; the readouts name the
 * profile so an opened file's time says whose machine it assumed.
 */
export type GcodeInspectionTiming = {
  readonly limits: MotionLimits;
  readonly cutTimeScale?: number;
  readonly travelTimeScale?: number;
  readonly deviceName: string;
};

export type GcodeInspectionContext = Pick<
  BuildRenderModelOptions,
  'machineKind' | 'laserPowerControl'
> & {
  readonly timing?: GcodeInspectionTiming;
};

export type GcodeInspectionSource = (
  | { readonly kind: 'blob'; readonly blob: Blob }
  | { readonly kind: 'text'; readonly text: string }
) &
  GcodeInspectionContext;

/** Context belongs to the compiled snapshot; arbitrary imported programs have
 * no inferred machine kind because CNC and laser share M3/M4/S words. */
export function projectInspectionContext(project: Project): GcodeInspectionContext {
  return deviceInspectionContext(project.device, project.machine?.kind ?? 'laser');
}

export function deviceInspectionContext(
  device: DeviceProfile,
  machineKind: 'laser' | 'cnc',
): GcodeInspectionContext {
  const timing = deviceInspectionTiming(device);
  if (machineKind === 'cnc') return { machineKind: 'cnc', timing };
  return { machineKind: 'laser', laserPowerControl: laserPowerControlForDevice(device), timing };
}

/** The same limits and calibration Job Review times the device's jobs with. */
export function deviceInspectionTiming(device: DeviceProfile): GcodeInspectionTiming {
  return {
    limits: {
      accelMmPerSec2: device.accelMmPerSec2,
      junctionDeviationMm: device.junctionDeviationMm,
      maxFeedMmPerMin: device.maxFeed,
    },
    ...(device.estimateCutTimeScale === undefined
      ? {}
      : { cutTimeScale: device.estimateCutTimeScale }),
    ...(device.estimateTravelTimeScale === undefined
      ? {}
      : { travelTimeScale: device.estimateTravelTimeScale }),
    deviceName: device.name,
  };
}

/** An opened file carries no machine; time it for the current profile, as
 * Job Review would, and leave its machine kind uninferred. */
export function withDeviceTiming(
  source: GcodeInspectionSource,
  device: DeviceProfile,
): GcodeInspectionSource {
  return source.timing === undefined
    ? { ...source, timing: deviceInspectionTiming(device) }
    : source;
}

import { machineBoundsForDevice, type DeviceProfile } from '../../core/devices';
import type { MotionLimits } from '../../core/gcode-time';
import { laserPowerControlForDevice, type BuildRenderModelOptions } from '../../core/gcode-view';
import type { Project } from '../../core/scene';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dRect } from '../viewer3d/viewer3d-look';
import type { EmittedDesignPlacement } from '../laser/save-output-emission';
import { projectInspectionDesign, type GcodeInspectionDesign } from './inspection-design';

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
  /** The machine bed in program coordinates, only when the program runs in
   * that frame (an Absolute laser job). Studio outlines it (ADR-426). */
  readonly workArea?: Viewer3dRect;
  /** The project's stock and relief designs, for the carved stock (ADR-487).
   * The page keeps it: the parse worker is sent the source without it. */
  readonly design?: GcodeInspectionDesign;
};

export type GcodeInspectionSource = (
  | { readonly kind: 'blob'; readonly blob: Blob }
  | { readonly kind: 'text'; readonly text: string }
) &
  GcodeInspectionContext;

/** Context belongs to the compiled snapshot; arbitrary imported programs have
 * no inferred machine kind because CNC and laser share M3/M4/S words.
 * `placement` is where preparation put the design, when it is known. */
export function projectInspectionContext(
  project: Project,
  placement?: EmittedDesignPlacement,
): GcodeInspectionContext {
  const machineKind = project.machine?.kind ?? 'laser';
  const design = projectInspectionDesign(project, placement);
  const context = {
    ...deviceInspectionContext(project.device, machineKind),
    ...(design === undefined ? {} : { design }),
  };
  // Only an Absolute laser job is written in bed coordinates. Every other
  // start runs from a work zero the program cannot know, and a CNC program's
  // zero is on the stock, so no bed is drawn for those.
  if (machineKind !== 'laser' || project.jobSetup.placement.startFrom !== 'absolute') {
    return context;
  }
  const bed = machineBoundsForDevice(project.device);
  return {
    ...context,
    workArea: { minX: bed.minX, maxX: bed.maxX, minY: bed.minY, maxY: bed.maxY },
  };
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

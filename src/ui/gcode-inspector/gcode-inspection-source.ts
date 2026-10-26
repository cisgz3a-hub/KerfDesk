import {
  isRotaryActive,
  machineBoundsForDevice,
  rotaryYLimitMm,
  type DeviceProfile,
  type ControllerKind,
} from '../../core/devices';
import type { MotionLimits } from '../../core/gcode-time';
import { devicePlannerBlocks } from '../../core/gcode-time/program-timing-options';
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
  /** Blocks the device's planner holds, so fine moves are timed as it runs them (ADR-525). */
  readonly plannerBlocks?: number;
  readonly deviceName: string;
};

export type GcodeInspectionContext = Pick<
  BuildRenderModelOptions,
  // initialPositionMm: an external run reads its program from where the head
  // stands (ADR-630); other inspections start at the drawn origin.
  // boundsFromStart: its Frame outline keeps only motion placed in the work
  // coordinates the program starts in (ADR-630 Amendment 1).
  'machineKind' | 'laserPowerControl' | 'initialPositionMm' | 'boundsFromStart'
> & {
  /** The connected parser for an external run, independent of the saved profile. */
  readonly controllerKind?: ControllerKind;
  readonly timing?: GcodeInspectionTiming;
  /** The machine bed in program coordinates, only when the program runs in
   * that frame (an Absolute laser job). Studio outlines it (ADR-426). */
  readonly workArea?: Viewer3dRect;
  /** The project's stock and relief designs, for the carved stock (ADR-487).
   * The page keeps it: the parse worker is sent the source without it. */
  readonly design?: GcodeInspectionDesign;
  /** The laser the program burns with, for the burn preview (ADR-487). */
  readonly laser?: GcodeInspectionLaser;
};

/** A laser's full power, its beam and any rotary the work turns on. */
export type GcodeInspectionLaser = {
  /** The S value that is full power: the controller's $30. */
  readonly maxPowerS: number;
  /** The beam's width on the work: the head's spot, or 0.1 mm without one. */
  readonly spotMm: number;
  /** The head's optical power, when the machine profile states it (ADR-501). */
  readonly opticalPowerW?: number;
  /** A rotary set up and on: the work's diameter and the Y that turns it once. */
  readonly rotary?: { readonly diameterMm: number; readonly wrapYMm: number };
};

const DEFAULT_SPOT_MM = 0.1;

export type GcodeInspectionSource = (
  | { readonly kind: 'blob'; readonly blob: Blob }
  | { readonly kind: 'text'; readonly text: string }
) &
  GcodeInspectionContext & {
    /** A file the operator opened, which the Inspector may run (ADR-630);
     * the project's own program has Frame and Start already. */
    readonly openedFile?: true;
  };

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
  controllerKind?: ControllerKind,
): GcodeInspectionContext {
  const timing = deviceInspectionTiming(device, controllerKind);
  const controller = controllerKind === undefined ? {} : { controllerKind };
  if (machineKind === 'cnc') return { machineKind: 'cnc', timing, ...controller };
  return {
    machineKind: 'laser',
    laserPowerControl: laserPowerControlForDevice({ ...device, ...controller }),
    timing,
    laser: deviceInspectionLaser(device),
    ...controller,
  };
}

/** The device's laser as the burn preview draws it. */
export function deviceInspectionLaser(device: DeviceProfile): GcodeInspectionLaser {
  const spot = device.laserSubProfile?.spotSizeMm;
  const opticalPowerW = device.laserSubProfile?.opticalPowerW;
  const rotary = isRotaryActive(device.rotary) ? device.rotary : undefined;
  return {
    maxPowerS: device.maxPowerS,
    spotMm: spot === undefined ? DEFAULT_SPOT_MM : (spot.x + spot.y) / 2,
    ...(opticalPowerW === undefined ? {} : { opticalPowerW }),
    ...(rotary === undefined
      ? {}
      : { rotary: { diameterMm: rotary.objectDiameterMm, wrapYMm: rotaryYLimitMm(rotary) } }),
  };
}

/** The same limits and calibration Job Review times the device's jobs with. */
export function deviceInspectionTiming(
  device: DeviceProfile,
  controllerKind?: ControllerKind,
): GcodeInspectionTiming {
  const plannerBlocks = devicePlannerBlocks(device, controllerKind);
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
    ...(plannerBlocks === undefined ? {} : { plannerBlocks }),
    deviceName: device.name,
  };
}

/** An opened file carries no machine; time it for the current profile, as
 * Job Review would, and burn it with the current profile's laser, leaving its
 * machine kind uninferred. */
export function withCurrentDevice(
  source: GcodeInspectionSource,
  device: DeviceProfile,
): GcodeInspectionSource {
  if (source.timing !== undefined && source.laser !== undefined) return source;
  return {
    ...source,
    timing: source.timing ?? deviceInspectionTiming(device),
    laser: source.laser ?? deviceInspectionLaser(device),
  };
}

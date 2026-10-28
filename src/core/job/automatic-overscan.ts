// Automatic overscan (ADR-495): the laser-off run-up a scan needs to reach its
// speed from rest, worked out from the operation's speed and the machine's
// acceleration along the direction the head actually scans.
//
// GRBL caps a move's acceleration so that no drive goes past its own setting:
// the move's limit is each drive's acceleration divided by that drive's share
// of the direction, and the smallest wins. The machine profile keeps one value,
// the smaller of $120 and $121, and its kinematics say what the drives are
// (ADR-675, motion-planner/drive-share.ts):
// - Cartesian, one motor per axis: a scan at angle θ reaches
//   a / max(|cos θ|, |sin θ|). A 45-degree scan speeds up √2 times faster than
//   a scan along an axis and needs √2 times less runway.
// - CoreXY, motors A = X + Y and B = X - Y: a scan reaches
//   a / (|cos θ| + |sin θ|). A 45-degree scan speeds up √2 times slower and
//   needs √2 times more runway.
//
// The run-up is the whole v² / 2a from rest plus a 10% margin, rounded up to
// 0.1 mm and held inside the Overscan field's range. It is worked out again at
// every compile, so it follows a change of speed, angle or acceleration.

import type { DeviceProfile } from '../devices';
import { machineKinematics, type MachineKinematics } from '../devices/device-profile';
import { effectiveGcodeFeedMmPerMin } from '../gcode/feed-word';
import { busiestDriveShareAtAngle } from '../motion-planner/drive-share';
import type { LayerOperationSettings } from '../scene';
import { MAX_FILL_OVERSCAN_MM } from './compile-job-defaults';
import {
  accelerationDistanceMm,
  imageOverscanMmFor,
  MAX_IMAGE_OVERSCAN_MM,
} from './operation-cut-extras';

const MARGIN = 1.1;
const STEPS_PER_MM = 10;

type AutomaticOverscanInput = {
  readonly feedMmPerMin: number;
  readonly accelMmPerSec2: number;
  readonly kinematics: MachineKinematics;
  /** Scan direction in degrees; only its angle to the axes matters. */
  readonly scanAngleDeg: number;
  readonly maxMm: number;
};

type ScanDevice = Pick<DeviceProfile, 'maxFeed' | 'accelMmPerSec2' | 'kinematics'>;

/** The run-up to reach `feedMmPerMin` from rest along the scan, with margin. */
export function automaticOverscanMm(input: AutomaticOverscanInput): number {
  const alongScanAccel = alongScanAccelMmPerSec2(
    input.accelMmPerSec2,
    input.scanAngleDeg,
    input.kinematics,
  );
  const runupMm = accelerationDistanceMm(input.feedMmPerMin, alongScanAccel) * MARGIN;
  // Rounded up on a 0.1 mm grid, after trimming float noise so 1.1 stays 1.1.
  const stepped = Math.ceil(Number((runupMm * STEPS_PER_MM).toFixed(6))) / STEPS_PER_MM;
  return Math.max(0, Math.min(input.maxMm, stepped));
}

/** The fastest feed a run-up of `runwayMm` along the X axis covers, margin included. */
export function automaticOverscanReachMmPerMin(runwayMm: number, accelMmPerSec2: number): number {
  if (!(runwayMm > 0) || !(accelMmPerSec2 > 0)) return 0;
  return Math.sqrt((2 * accelMmPerSec2 * runwayMm) / MARGIN) * 60;
}

/** The least acceleration a move at this angle gets from the profile's value. */
export function alongScanAccelMmPerSec2(
  accelMmPerSec2: number,
  scanAngleDeg: number,
  kinematics: MachineKinematics,
): number {
  return accelMmPerSec2 / busiestDriveShareAtAngle(kinematics, scanAngleDeg);
}

/**
 * The scan angle whose automatic runway is longest on this machine: along an
 * axis on a Cartesian machine, on the diagonal on a CoreXY one.
 */
export function longestRunwayScanAngleDeg(kinematics: MachineKinematics): number {
  return kinematics === 'corexy' ? 45 : 0;
}

/** The feed a scan of this operation runs at on this machine. */
export function scanFeedMmPerMin(
  settings: Pick<LayerOperationSettings, 'speed'>,
  device: Pick<DeviceProfile, 'maxFeed'>,
): number {
  return effectiveGcodeFeedMmPerMin(Math.min(settings.speed, device.maxFeed));
}

/** An Image operation's runway at one scan angle: automatic, or as stored. */
export function imageScanOverscanMm(
  settings: Pick<LayerOperationSettings, 'speed' | 'imageOverscanMm' | 'autoOverscan'>,
  device: ScanDevice,
  scanAngleDeg: number,
): number {
  if (settings.autoOverscan !== true) return imageOverscanMmFor(settings);
  return automaticOverscanMm({
    feedMmPerMin: scanFeedMmPerMin(settings, device),
    accelMmPerSec2: device.accelMmPerSec2,
    kinematics: machineKinematics(device),
    scanAngleDeg,
    maxMm: MAX_IMAGE_OVERSCAN_MM,
  });
}

/**
 * A scanline or island Fill's runway: automatic at its hatch angle, or as
 * stored. A cross-hatch pass runs 90 degrees on, where the drive share is the
 * same in both layouts, so one length serves both. Offset rings keep the
 * stored value, which they use as a contour entry length.
 */
export function fillScanOverscanMm(
  settings: Pick<
    LayerOperationSettings,
    'speed' | 'fillOverscanMm' | 'fillStyle' | 'hatchAngleDeg' | 'autoOverscan'
  >,
  device: ScanDevice,
): number {
  if (settings.autoOverscan !== true || settings.fillStyle === 'offset') {
    return Math.max(0, settings.fillOverscanMm);
  }
  return automaticOverscanMm({
    feedMmPerMin: scanFeedMmPerMin(settings, device),
    accelMmPerSec2: device.accelMmPerSec2,
    kinematics: machineKinematics(device),
    scanAngleDeg: settings.hatchAngleDeg,
    maxMm: MAX_FILL_OVERSCAN_MM,
  });
}

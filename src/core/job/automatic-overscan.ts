// Automatic overscan (ADR-495): the laser-off run-up a scan needs to reach its
// speed from rest, worked out from the operation's speed and the machine's
// acceleration along the direction the head actually scans.
//
// GRBL caps a move's acceleration so that no axis goes past its own setting:
// the move's limit is each axis's acceleration divided by that axis's share of
// the direction, and the smallest wins. The machine profile keeps one value,
// the smaller of $120 and $121, so a scan at angle θ reaches at least
// a / max(|cos θ|, |sin θ|). A 45-degree scan speeds up √2 times faster than a
// scan along an axis and needs √2 times less runway.
//
// The run-up is the whole v² / 2a from rest plus a 10% margin, rounded up to
// 0.1 mm and held inside the Overscan field's range. It is worked out again at
// every compile, so it follows a change of speed, angle or acceleration.

import type { DeviceProfile } from '../devices';
import { effectiveGcodeFeedMmPerMin } from '../gcode/feed-word';
import type { LayerOperationSettings } from '../scene';
import { MAX_FILL_OVERSCAN_MM } from './compile-job-defaults';
import {
  accelerationDistanceMm,
  imageOverscanMmFor,
  MAX_IMAGE_OVERSCAN_MM,
} from './operation-cut-extras';

const MARGIN = 1.1;
const STEPS_PER_MM = 10;
const DEG_TO_RAD = Math.PI / 180;

type AutomaticOverscanInput = {
  readonly feedMmPerMin: number;
  readonly accelMmPerSec2: number;
  /** Scan direction in degrees; only its angle to the axes matters. */
  readonly scanAngleDeg: number;
  readonly maxMm: number;
};

/** The run-up to reach `feedMmPerMin` from rest along the scan, with margin. */
export function automaticOverscanMm(input: AutomaticOverscanInput): number {
  const alongScanAccel = alongScanAccelMmPerSec2(input.accelMmPerSec2, input.scanAngleDeg);
  const runupMm = accelerationDistanceMm(input.feedMmPerMin, alongScanAccel) * MARGIN;
  // Rounded up on a 0.1 mm grid, after trimming float noise so 1.1 stays 1.1.
  const stepped = Math.ceil(Number((runupMm * STEPS_PER_MM).toFixed(6))) / STEPS_PER_MM;
  return Math.max(0, Math.min(input.maxMm, stepped));
}

/** The least acceleration a move at this angle gets from the profile's value. */
export function alongScanAccelMmPerSec2(accelMmPerSec2: number, scanAngleDeg: number): number {
  return accelMmPerSec2 / scanAxisShare(scanAngleDeg);
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
  device: Pick<DeviceProfile, 'maxFeed' | 'accelMmPerSec2'>,
  scanAngleDeg: number,
): number {
  if (settings.autoOverscan !== true) return imageOverscanMmFor(settings);
  return automaticOverscanMm({
    feedMmPerMin: scanFeedMmPerMin(settings, device),
    accelMmPerSec2: device.accelMmPerSec2,
    scanAngleDeg,
    maxMm: MAX_IMAGE_OVERSCAN_MM,
  });
}

/**
 * A scanline or island Fill's runway: automatic at its hatch angle, or as
 * stored. A cross-hatch pass runs 90 degrees on, where the axis share is the
 * same, so one length serves both. Offset rings keep the stored value, which
 * they use as a contour entry length.
 */
export function fillScanOverscanMm(
  settings: Pick<
    LayerOperationSettings,
    'speed' | 'fillOverscanMm' | 'fillStyle' | 'hatchAngleDeg' | 'autoOverscan'
  >,
  device: Pick<DeviceProfile, 'maxFeed' | 'accelMmPerSec2'>,
): number {
  if (settings.autoOverscan !== true || settings.fillStyle === 'offset') {
    return Math.max(0, settings.fillOverscanMm);
  }
  return automaticOverscanMm({
    feedMmPerMin: scanFeedMmPerMin(settings, device),
    accelMmPerSec2: device.accelMmPerSec2,
    scanAngleDeg: settings.hatchAngleDeg,
    maxMm: MAX_FILL_OVERSCAN_MM,
  });
}

// max(|cos θ|, |sin θ|): 1 along an axis, 1/√2 on a diagonal.
function scanAxisShare(scanAngleDeg: number): number {
  if (!Number.isFinite(scanAngleDeg)) return 1;
  const rad = scanAngleDeg * DEG_TO_RAD;
  return Math.max(Math.abs(Math.cos(rad)), Math.abs(Math.sin(rad)));
}

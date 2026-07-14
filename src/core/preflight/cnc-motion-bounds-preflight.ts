import { machineBoundsForDevice, type DeviceProfile } from '../devices';
import { findOutOfBoundsCoords, type MotionBoundsOffset } from '../invariants';
import type { PreflightIssue } from './preflight';
import { findRelativeMotionEnvelopeIssues } from './relative-motion-envelope';

const MAX_REPORTED_ISSUES = 5;

type CncMotionBoundsOptions = {
  readonly motionOffset?: MotionBoundsOffset | undefined;
  readonly coordinateMode?: 'machine' | 'relative-origin';
};

/** Checks CNC motion in the coordinate frame whose physical position is actually known. */
export function findCncMotionBoundsPreflightIssues(
  device: DeviceProfile,
  gcode: string,
  options: CncMotionBoundsOptions,
): ReadonlyArray<PreflightIssue> {
  const machineBounds = machineBoundsForDevice(device);
  if (options.coordinateMode === 'relative-origin' && options.motionOffset === undefined) {
    return findRelativeMotionEnvelopeIssues(gcode, machineBounds)
      .slice(0, MAX_REPORTED_ISSUES)
      .map((message) => ({ code: 'out-of-bed', message }));
  }
  return findOutOfBoundsCoords(gcode, machineBounds, { motionOffset: options.motionOffset })
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => ({
      code: 'out-of-bed',
      message: `Line ${issue.lineNumber}: ${issue.reason}`,
    }));
}

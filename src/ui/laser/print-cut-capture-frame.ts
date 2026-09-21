// Convert a captured controller position into the frame the Print & Cut
// solver works in.
//
// The registration transform is solved against the operator's DESIGN targets
// and then applied to scene-frame objects (prepare-output-snapshot applies it
// before compile-job runs toMachineCoords). So the captured point has to be
// expressed in scene coordinates too. Capturing the raw report mixed two
// frames: only 'rear-left' is the identity origin, so on the other four the
// solved transform landed the design at the wrong Y and, on the right-hand
// origins, with the rotation sign flipped.
//
// With a verified mapping, native MPos enters the profile-bed frame before
// the scene, paired with Absolute output's inverse translation. Otherwise
// retain controller-relative registration: scene -> compile round-trips the
// captured controller number, without claiming its physical bed location.

import { normalizeReportedMPosToMm } from '../../core/controllers/grbl/machine-envelope';
import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import type { Vec2 } from '../../core/scene';
import { nativePointToBed, type NativeBedFrame } from '../../core/devices/native-bed-frame';

type ReportedPoint = { readonly x: number; readonly y: number; readonly z: number };

/**
 * Scene-frame point for a captured controller position, or null when the
 * report cannot be trusted (non-finite axis). Returning null rather than
 * throwing keeps the capture button inert on a bad frame instead of taking
 * down the dialog.
 */
export function capturedMachinePointToScene(
  reported: ReportedPoint,
  device: DeviceProfile,
  reportInches: boolean,
  frame: NativeBedFrame | null,
): Vec2 | null {
  if (![reported.x, reported.y, reported.z].every(Number.isFinite)) return null;
  const [xMm, yMm] = normalizeReportedMPosToMm([reported.x, reported.y, reported.z], reportInches);
  const point = { x: xMm, y: yMm };
  return toSceneCoords(frame === null ? point : nativePointToBed(point, frame), device);
}

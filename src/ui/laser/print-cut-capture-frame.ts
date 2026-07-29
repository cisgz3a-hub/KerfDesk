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
// Machine -> scene follows the same convention the live head overlay already
// uses (canvas-motion-plan's 'machine' coordinate frame maps MPos straight
// through toSceneCoords), so a captured mark means the same thing on canvas
// as the head the operator just jogged there. WCO is deliberately NOT
// subtracted here for that reason; if that convention ever changes it must
// change for the head overlay and this together, not for one of them.

import { normalizeReportedMPosToMm } from '../../core/controllers/grbl/machine-envelope';
import { toSceneCoords, type DeviceProfile } from '../../core/devices';
import type { Vec2 } from '../../core/scene';

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
): Vec2 | null {
  if (!Number.isFinite(reported.x) || !Number.isFinite(reported.y)) return null;
  const [xMm, yMm] = normalizeReportedMPosToMm([reported.x, reported.y, reported.z], reportInches);
  return toSceneCoords({ x: xMm, y: yMm }, device);
}

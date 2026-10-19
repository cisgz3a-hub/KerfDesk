// board-sight — what the operator lines up with a board corner (ADR-636): the
// laser head itself, or the machine's separate positioning light (red dot /
// crosshair) while it is switched on. The light sits a configured offset from
// the beam (Machine Setup, "pointer spot minus laser spot" along the canvas bed
// axes), so a corner sighted with it is the head position plus that offset,
// and a move meant to put the light on a point targets the point minus it.

import { jogAxisSignsForOrigin } from '../../../core/devices/jog-direction';
import { toMachineCoords } from '../../../core/devices/origin-transform';
import {
  positioningLightIssue,
  positioningLightSupported,
} from '../../../core/devices/positioning-light';
import type { DeviceProfile } from '../../../core/devices/device-profile';
import type { BoardAxisSigns, Vec2 } from '../../../core/scene';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';

const ZERO: Vec2 = { x: 0, y: 0 };

/** True when this profile has a usable separate positioning light. */
export function boardPointerConfigured(device: DeviceProfile): boolean {
  return (
    device.positioningLight !== undefined &&
    device.controllerKind !== 'ruida' &&
    positioningLightSupported(device.gcodeDialect?.dialectId) &&
    positioningLightIssue(
      device.positioningLight,
      device.controllerKind,
      device.gcodeDialect?.dialectId,
    ) === null
  );
}

/** The light's offset from the beam as a machine-axis vector, in mm. */
export function boardPointerOffsetMm(device: DeviceProfile): Vec2 {
  const light = device.positioningLight;
  if (light === undefined) return ZERO;
  // Only the offset vector needs the origin transform; its translation cancels.
  const zero = toMachineCoords(ZERO, device);
  const pointer = toMachineCoords({ x: light.offsetXmm, y: light.offsetYmm }, device);
  return { x: pointer.x - zero.x, y: pointer.y - zero.y };
}

/** The offset to add to the head position for what the operator is aiming with now. */
export function boardSightOffsetMm(): Vec2 {
  if (!useLaserStore.getState().positioningLightEnabled) return ZERO;
  const device = useStore.getState().project.device;
  return boardPointerConfigured(device) ? boardPointerOffsetMm(device) : ZERO;
}

export function sightedPoint(head: Vec2, offset: Vec2 = boardSightOffsetMm()): Vec2 {
  return { x: head.x + offset.x, y: head.y + offset.y };
}

/** Where the head must go so the sight (light or beam) lands on `point`. */
export function headTargetForSight(point: Vec2, offset: Vec2 = boardSightOffsetMm()): Vec2 {
  return { x: point.x - offset.x, y: point.y - offset.y };
}

export function boardAxisSigns(): BoardAxisSigns {
  return jogAxisSignsForOrigin(useStore.getState().project.device.origin);
}

export function isFrontLeftSigns(signs: BoardAxisSigns): boolean {
  return signs.x === 1 && signs.y === 1;
}

// The limits the time model plans each block with (ADR-675).
//
// A Cartesian machine is planned with the profile's acceleration and max rate
// in every direction, as before. GRBL gives a Cartesian move at least that much
// (drive-share.ts), so the estimate errs long and stays as it was. A CoreXY
// machine gives a move off the axes less, down to limit / √2 on a diagonal, so
// its blocks are planned with the limit divided by the busiest motor's share.

import type { MachineKinematics } from '../devices/device-profile';
import type { Block, BlockDirection } from './block';
import { busiestDriveShare } from './drive-share';

/** How many times slower than the profile's limits this direction is planned. */
export function plannedDriveShare(
  kinematics: MachineKinematics,
  direction: BlockDirection,
): number {
  if (kinematics !== 'corexy') return 1;
  return Math.max(1, busiestDriveShare(kinematics, direction));
}

/** The acceleration one block is planned at. */
export function blockAcceleration(
  block: Pick<Block, 'direction'>,
  accel: number,
  kinematics: MachineKinematics,
): number {
  return accel / plannedDriveShare(kinematics, block.direction);
}

/**
 * The acceleration and junction deviation a corner between two blocks is
 * planned with (grblHAL planner.c, plan_buffer_line: the junction speed uses
 * the acceleration along the junction vector, u_next - u_prev). CoreXY plans
 * in motor space, where an XY move is √2 times longer, so the junction
 * deviation there is √2 times shorter in head millimetres. Outside the XY
 * plane the Z motor is not scaled, so the deviation stays as set.
 */
export function junctionPlanningLimits(
  prev: Pick<Block, 'direction'>,
  next: Pick<Block, 'direction'>,
  accel: number,
  jd: number,
  kinematics: MachineKinematics,
): { readonly accel: number; readonly jd: number } {
  if (kinematics !== 'corexy') return { accel, jd };
  const x = next.direction.x - prev.direction.x;
  const y = next.direction.y - prev.direction.y;
  const z = (next.direction.z ?? 0) - (prev.direction.z ?? 0);
  const length = Math.hypot(x, y, z);
  const share =
    length > 0 ? plannedDriveShare(kinematics, { x: x / length, y: y / length, z: z / length }) : 1;
  const planar = (prev.direction.z ?? 0) === 0 && (next.direction.z ?? 0) === 0;
  return { accel: accel / share, jd: planar ? jd / Math.SQRT2 : jd };
}

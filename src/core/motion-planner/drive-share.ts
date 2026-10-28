// How much of a per-axis or per-motor limit reaches a move (ADR-675; rolling
// audit v6 K3-P2-2).
//
// The planner limits speed and acceleration drive by drive. For a block whose
// unit direction is u, it divides each drive's limit by that drive's share of
// the move and keeps the smallest:
//   limit along the move = min over drives i of limit_i / |u_i|
// (grblHAL planner.c, limit_acceleration_by_axis_maximum and
// limit_max_rate_by_axis_maximum; stock GRBL 1.1's limit_value_by_axis_maximum
// in nuts_bolts.c does the same).
// KerfDesk keeps one value for X and Y, the smaller of $120 and $121, so a move
// gets that value divided by the share its busiest drive carries.
//
// Cartesian: each axis has its own motor, so the shares are |ux|, |uy|, |uz|
// and a move gets limit / max(|ux|, |uy|): the limit along an axis, √2 times
// it on a 45° diagonal.
//
// CoreXY (grblHAL kinematics/corexy.c): mc_line hands every target to
// kinematics.segment_line (motion_control.c), which converts it to motor
// positions, motor A = X + Y and motor B = X - Y (transform_from_cartesian),
// and scales the feed by motor distance over Cartesian distance. The planner
// then works on the motor-space vector (planner.c, plan_buffer_line, from
// target_steps). A head move along u turns motor A at |ux + uy| and motor B at
// |ux - uy| of the head's speed, so it gets
//   limit / max(|ux + uy|, |ux - uy|) = limit / (|ux| + |uy|)
// for a move in the XY plane: the limit along an axis, limit / √2 on a 45°
// diagonal. So a diagonal on CoreXY has half the acceleration the Cartesian
// model gives it.
//
// Sources (grblHAL core f8f10aec, the CoreXY v2.02 the Falcon A1 Pro reports):
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/kinematics/corexy.c#L68-L78
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/kinematics/corexy.c#L197-L222
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/motion_control.c#L83
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/planner.c#L342-L366
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/planner.c#L416-L420
// https://github.com/grblHAL/core/blob/f8f10aecdf05943e3a02b1ac3c691b666a811495/planner.c#L504-L506
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/nuts_bolts.c#L180-L190

import type { MachineKinematics } from '../devices/device-profile';

type Direction = { readonly x: number; readonly y: number; readonly z?: number };

/**
 * The share of a unit-direction move its busiest drive carries: 1 along an
 * axis; 1/√2 on a Cartesian diagonal and √2 on a CoreXY one. A drive limit L
 * allows L / share along the move. Z has its own motor in both layouts.
 */
export function busiestDriveShare(kinematics: MachineKinematics, direction: Direction): number {
  const { x, y } = direction;
  const z = Math.abs(direction.z ?? 0);
  const share =
    kinematics === 'corexy'
      ? Math.max(Math.abs(x + y), Math.abs(x - y), z)
      : Math.max(Math.abs(x), Math.abs(y), z);
  return share > 0 && Number.isFinite(share) ? share : 1;
}

/** `busiestDriveShare` for a move in the XY plane at `angleDeg` to the X axis. */
export function busiestDriveShareAtAngle(kinematics: MachineKinematics, angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) return 1;
  const rad = (angleDeg * Math.PI) / 180;
  return busiestDriveShare(kinematics, { x: Math.cos(rad), y: Math.sin(rad) });
}

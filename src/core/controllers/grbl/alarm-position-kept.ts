// alarm-position-kept: the alarms a GRBL-family controller keeps its machine
// position through (user annoyance audit A1, A3-P2-1; ADR-367 Amendment 3).
//
// Unlock (`$X`) used to hide the reported position after every alarm but a
// failed probe. It now reads the alarm tables' `positionLost` flag, which this
// file checks against the firmware for the codes marked false. Every other
// code, and every code a table does not list, counts as losing position.
//
// ALARM:2, soft limit, on all three firmwares: the planner checks the target
// before the move is queued, brings a running cycle to a controlled stop with a
// feed hold, and only then raises the alarm. The step count is never cut short,
// and the soft reset the alarm then asks for keeps the machine position (stock
// GRBL clears it only at power-up; grblHAL keeps `sys.position` outside the
// part of its state a reset clears). Both firmwares' own alarm texts say
// "Machine position retained. Alarm may be safely unlocked."
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/csv/alarm_codes_en_US.csv#L3
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L411-L430
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/main.c#L47
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/main.c#L72-L75
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/alarms.c#L31
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L628-L650
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.h#L275-L287
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/grbllib.c#L458-L461
// https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/Limit.cpp#L117-L134
// https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/Protocol.cpp#L756-L761
//
// One path through that code does stop the motors abruptly and still reports
// ALARM:2: stock GRBL and grblHAL run the feed hold only from the Cycle state,
// so a target that fails the check while a feed hold is already slowing the
// machine goes straight to `mc_reset`, which kills the steppers when a hold is
// executing; the soft-limit code then replaces the abort code it set (the
// alarm is one value, not a set of flags). The caller therefore does not count
// an ALARM:2 raised under a hold (position-kept-alarm.ts). FluidNC waits for
// the planner to drain first, so it has no such path.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L386
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L370-L375
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/motion_control.c#L1196-L1204
//
// ALARM:4 and 5, a failed probe: probe-failure-alarm.ts.
//
// FluidNC ALARM:17, a G-code error in a job FluidNC runs itself (a file or a
// macro): the alarm only sets the Alarm state. Nothing stops the steppers,
// which finish the moves already planned, and no axis is marked unhomed, as it
// is for a hard limit or hard stop.
// https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/ProcessSettings.cpp#L1377-L1383
// https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/Protocol.cpp#L734-L764
//
// Not position-kept, although nothing moves when they are raised: the power-on
// lock. Stock GRBL locks a homing machine at power-up with no alarm code, right
// after clearing its machine position; grblHAL raises ALARM:11 and FluidNC
// ALARM:14 only while an axis that homes has not been homed. The number the
// controller reports there is not a measured position.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/main.c#L47-L67
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L668-L673
// https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/Protocol.cpp#L726-L730

import type { ControllerKind } from '../../devices';
import { presentAlarm } from './response-presentation';

const GRBL_FAMILY: ReadonlySet<ControllerKind> = new Set(['grbl-v1.1', 'grblhal', 'fluidnc']);

/** True only when this firmware's alarm table lists the code and marks it as
 *  keeping the machine position. Marlin, Smoothieware and Ruida raise no
 *  numbered GRBL alarm, so nothing is position-kept there. */
export function alarmKeepsMachinePosition(controllerKind: ControllerKind, code: number): boolean {
  if (!GRBL_FAMILY.has(controllerKind)) return false;
  return presentAlarm(controllerKind, code)?.positionLost === false;
}

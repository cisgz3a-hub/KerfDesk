// Smoothieware prints MPos and WPos through Robot::from_millimeters, which
// divides by 25.4 in inch mode, in the Idle report as in the Run one (Kernel.cpp
// L214-L234, L262-L287; Robot.h L52-L53). G20 and G21 set that mode (Robot.cpp
// L601-L602), and M121 puts back the mode M120 saved (push_state/pop_state,
// Robot.cpp L344-L365), so the jog's own G21 inside M120/M121 does not last. A
// Console G20 therefore left every later report in inches while KerfDesk read
// millimetres, and the next point move landed 25.4 times off (rolling audit v3
// G4-P1-2). The GRBL family's reports follow `$13` instead (gnea/grbl print.c
// printFloat_CoordValue, grblHAL report.c L202-L204, FluidNC Report.cpp
// L82-L84), and Marlin's M114 prints logical millimetres whatever G20 selects
// (motion.cpp report_logical_position, L191-L212).
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/libs/Kernel.cpp#L262-L287
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.cpp#L344-L365
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.cpp#L601-L602
// https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/motion.cpp#L191-L212

import type { ReportUnitsSelection } from '../controller-driver';

// Read loosely, comments, spaces and leading zeros included: a word the
// firmware would not run costs one `$G` read, while a missed one moves the head
// to the wrong place.
const INCHES_RE = /G\s*0*20(?![0-9])/i;
const MILLIMETRES_RE = /G\s*0*21(?![0-9])/i;
const POP_STATE_RE = /M\s*0*121(?![0-9])/i;

/** The units a Smoothieware line leaves its reports in, or null when it
 *  selects none. M121 restores units KerfDesk did not see saved. */
export function smoothieReportUnitsSelectedBy(line: string): ReportUnitsSelection | null {
  const inches = INCHES_RE.test(line);
  const millimetres = MILLIMETRES_RE.test(line);
  if (POP_STATE_RE.test(line) || (inches && millimetres)) return 'unknown';
  if (inches) return 'inches';
  return millimetres ? 'millimetres' : null;
}

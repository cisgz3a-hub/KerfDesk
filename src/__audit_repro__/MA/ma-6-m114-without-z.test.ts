// Audit track MA (Marlin), finding MA-6: M114 from a Marlin build without a Z
// axis is not recognised as a position report.
//
// POSITION_RE in core/controllers/marlin/response.ts requires `X:`, `Y:` and
// `Z:`. Marlin 2.1.2.8 supports machines with NUM_AXES == 2 (Conditionals_LCD.h
// derives NUM_AXES from the defined *_DRIVER_TYPEs; with Z_DRIVER_TYPE left
// undefined HAS_Z_AXIS is not defined, and SanityCheck.h only forbids leveling
// and CNC_WORKSPACE_PLANES without Z). M114 prints one label per axis
// (motion.cpp report_logical_position: LIST_N(DOUBLE(NUM_AXES), X_LBL, ...,
// SP_Y_LBL, ..., SP_Z_LBL, ...), plus ` E:` only when HAS_EXTRUDERS, then the
// stepper counts per axis (stepper.cpp report_a_position). An XY laser build
// therefore answers `X:10.00 Y:5.00 Count X:800 Y:400` (EXTRUDERS 0). KerfDesk
// classifies that as `unknown`, so no queued poll ever yields a status: the
// board is reported silent after 8 s, never qualifies, and Jog/Frame/Start
// have no Idle report.
//
// Upstream: https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/inc/Conditionals_LCD.h#L233-L262
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/motion.cpp#L192-L212
//           https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/stepper.cpp#L3260-L3274
//
// Correct behaviour: an M114 line with X and Y (and no Z) parses as a status
// report with z = 0 (or an explicit "no Z" value).

import { describe, expect, it } from 'vitest';
import { classifyMarlinResponse } from '../../core/controllers/marlin/response';

describe('MA-6: Marlin M114 without a Z axis', () => {
  it.each(['X:10.00 Y:5.00 Count X:800 Y:400', 'X:10.00 Y:5.00 E:0.00 Count X:800 Y:400'])(
    'parses %s as a position report',
    (line) => {
      // Current code: { kind: 'unknown' }.
      expect(classifyMarlinResponse(line)).toMatchObject({
        kind: 'status',
        report: { mPos: { x: 10, y: 5 } },
      });
    },
  );
});

// Marlin command vocabulary for laser rigs. No realtime bytes exist on this
// firmware: everything is a queued G-code/M-code line acked with `ok`.

import { buildAbsoluteFrameLines, buildRelativeJogCommand } from '../relative-jog-commands';

/** Home X/Y only — plain G28 also homes Z, which on a laser conversion
 *  without a Z endstop would crash the head into the bed. */
export const MARLIN_CMD_HOME_XY = 'G28 X Y';

/** M400 blocks until every buffered move has finished, then acks — the exact
 *  semantics the settle-marker pattern needs (GRBL uses a G4 dwell). */
export const MARLIN_CMD_SETTLE = 'M400';

/** M5 I drains queued movement and exits modern LASER_FEATURE inline mode;
 * plain M5 would leave that mode selected. M107 covers fan-mosfet wiring.
 * Both are queued commands, not an emergency stop. */
export const MARLIN_STOP_LASER_LINES: ReadonlyArray<string> = ['M5 I', 'M107'];

/** Quickstop: abort every planned move and the one in progress. */
export const MARLIN_CMD_QUICK_STOP = 'M410';

/**
 * Abort and ABORT MOTION on Marlin (controller audit MA-7). Marlin 2.1.2.8
 * acts on M410 when it reads the line, before the line is queued, whether or
 * not EMERGENCY_PARSER is on (gcode/queue.cpp L538-L545; e_parser.h L217),
 * and reads lines even while a G1 waits for a planner slot (MarlinCore.cpp
 * manage_inactivity). quick_stop() drops every block without a reset and
 * refuses moves for the next second (module/planner.cpp L1678-L1705). The
 * enqueued M410 then runs quickstop_stepper() again, waits out that second
 * and resyncs the position from the steppers (module/motion.cpp L382-L387),
 * which the steppers may have lost (M108_M112_M410.cpp L46-L53).
 * - M107 goes first: it does not synchronize, so a fan-wired laser is off as
 *   soon as the planner is dropped instead of a second later behind M410.
 * - M5 I follows: M410 leaves a continuous inline output lit, and M5
 *   synchronizes, so it runs once the quickstop window has passed
 *   (M3-M5.cpp L142-L154; stock LASER_SAFETY_TIMEOUT_MS also ends it).
 * Every line is an ordinary queued line that answers `ok`.
 */
export const MARLIN_QUICK_STOP_LINES: ReadonlyArray<string> = [
  'M107',
  MARLIN_CMD_QUICK_STOP,
  'M5 I',
];

/** Queued position query; replies `X:.. Y:.. Z:.. E:.. Count ..` then ok. */
export const MARLIN_CMD_POSITION = 'M114';

export const MARLIN_CMD_FIRMWARE_INFO = 'M115';
export const MARLIN_CMD_SETTINGS_DUMP = 'M503';
export const MARLIN_CMD_TEMPERATURES = 'M105';
export const MARLIN_CMD_EMERGENCY_STOP = 'M112';
/** kill() stops interrupts and waits for the board's RESET (or KILL) button
 * or a power cycle (MarlinCore.cpp L889-L957); reopening the port resets only
 * a board whose USB-serial chip pulses reset on open. */
export const MARLIN_HALT_RECOVERY =
  "press the controller's reset button or power-cycle it, then reconnect";

// Marlin has no native jog protocol: reuse the shared relative-jog / absolute-
// frame builders (byte-identical to the Smoothieware path).
export const buildMarlinJogCommand = buildRelativeJogCommand;
export const buildMarlinFrameLines = buildAbsoluteFrameLines;

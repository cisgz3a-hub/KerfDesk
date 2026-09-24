// Smoothieware command vocabulary. Generic serial supports ? and Ctrl-X;
// !/~ require additional transport/configuration evidence. Halt recovery is M999.

import { buildAbsoluteFrameLines, buildRelativeJogCommand } from '../relative-jog-commands';
import type { FrameBounds } from '../controller-driver';
import type { JogParams } from '../grbl/commands';

/**
 * Home all configured axes. `$H`, not G28.2: G28.2 homes only in grbl mode
 * and merely rapids to the saved park point (machine 0,0 by default) in the
 * Reprap dialect, which is the default on the non-CNC firmware.bin build
 * (Endstops.cpp on_gcode_received case 2; Kernel.cpp grbl_mode default).
 * SimpleShell maps `$H` to G28.2 in grbl mode and G28 otherwise, and prints
 * `ok` only after the blocking homing cycle, so it homes in both dialects.
 * https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/utils/simpleshell/SimpleShell.cpp
 * https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/tools/endstops/Endstops.cpp
 */
export const SMOOTHIE_CMD_HOME = '$H';

/** Clear the halted (kill/limit) state. */
export const SMOOTHIE_CMD_UNLOCK = 'M999';

export const SMOOTHIE_CMD_POSITION = 'M114';
export const SMOOTHIE_CMD_FIRMWARE_INFO = 'M115';
/** SimpleShell `version`: prints the build line and the axis count, never `ok`. */
export const SMOOTHIE_CMD_VERSION = 'version';
export const SMOOTHIE_VERSION_COMPLETE_PREFIX = 'Build version:';

/** After Ctrl-X, ON_HALT has already disabled native/manual laser output.
 * M5/M9 clear optional spindle/switch accessories and are allowed while halted. */
export const SMOOTHIE_STOP_LASER_LINES: ReadonlyArray<string> = ['M5', 'M9'];

/** Native Laser.cpp manual mode ignores M3/M4/M5 and M221. The lowercase shell
 * command has a textual completion instead of `ok` on the qualified V1 build. */
export const SMOOTHIE_CMD_FIRE_OFF = 'fire off';
export const SMOOTHIE_FIRE_OFF_COMPLETE = 'turning laser off and returning to auto mode';
export const SMOOTHIE_FRAME_TOOL_OFF_LINES: ReadonlyArray<string> = [
  SMOOTHIE_CMD_FIRE_OFF,
  'M400',
  'M221 S0',
  'M5',
  'M9',
];

// Post-job settle marker. Smoothieware follows the RepRap convention where G4 P
// is MILLISECONDS (not GRBL's seconds), so `G4 P0.01` acks almost immediately and
// the settle could clear the streamer while buffered motion is still draining —
// the same failure CTL-02 fixed for Marlin. M400 ("wait for the move queue to
// empty") acks only once motion has finished. NOT hardware-verified.
export const SMOOTHIE_CMD_SETTLE = 'M400';

// Robot.cpp keeps a separate seek rate for G0 and takes it from any F on a G0
// line (`if (motion_mode == SEEK) seek_rate = F`). A jog or frame `G0 ... F`
// would therefore become the travel speed of every later bare `G0`, including
// a job's travel moves. M120/M121 push and pop the Robot modal state (feed and
// seek rate, absolute and inch mode, active WCS), so each manual move leaves
// the controller exactly as it found it. Parsed-time state, so the queued move
// keeps its own rate. Marlin gives M120/M121 a different meaning (endstops),
// which is why the wrapper lives here and not in the shared builders.
// https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/robot/Robot.cpp
export const SMOOTHIE_CMD_PUSH_STATE = 'M120';
export const SMOOTHIE_CMD_POP_STATE = 'M121';

// Smoothieware has no native jog protocol: reuse the shared relative-jog /
// absolute-frame builders inside a push/pop of the Robot modal state.
export function buildSmoothieJogCommand(params: JogParams): string {
  return [
    ...SMOOTHIE_FRAME_TOOL_OFF_LINES,
    SMOOTHIE_CMD_PUSH_STATE,
    buildRelativeJogCommand(params),
    SMOOTHIE_CMD_POP_STATE,
  ].join('\n');
}

export function buildSmoothieFrameLines(bounds: FrameBounds, feed: number): ReadonlyArray<string> {
  return [
    `${SMOOTHIE_CMD_PUSH_STATE}\n`,
    ...buildAbsoluteFrameLines(bounds, feed),
    `${SMOOTHIE_CMD_POP_STATE}\n`,
  ];
}

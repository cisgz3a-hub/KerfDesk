// Smoothieware command vocabulary. Generic serial supports ? and Ctrl-X;
// !/~ require additional transport/configuration evidence. Halt recovery is M999.

import { buildAbsoluteFrameLines, buildRelativeJogCommand } from '../relative-jog-commands';
import type { JogParams } from '../grbl/commands';

/** Home all configured axes (Smoothie's homing cycle). */
export const SMOOTHIE_CMD_HOME = 'G28.2';

/** Clear the halted (kill/limit) state. */
export const SMOOTHIE_CMD_UNLOCK = 'M999';

export const SMOOTHIE_CMD_POSITION = 'M114';
export const SMOOTHIE_CMD_FIRMWARE_INFO = 'M115';
export const SMOOTHIE_CMD_VERSION = 'version';

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

// Smoothieware has no native jog protocol: reuse the shared relative-jog /
// absolute-frame builders (byte-identical to the Marlin path).
export function buildSmoothieJogCommand(params: JogParams): string {
  return [...SMOOTHIE_FRAME_TOOL_OFF_LINES, buildRelativeJogCommand(params)].join('\n');
}
export const buildSmoothieFrameLines = buildAbsoluteFrameLines;

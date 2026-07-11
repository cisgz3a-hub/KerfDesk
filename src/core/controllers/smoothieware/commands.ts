// Smoothieware command vocabulary. Realtime `?` / `!` / `~` / Ctrl-X are
// supported like GRBL; there is no `$J` jog protocol, `$$` settings dump,
// `$X` unlock, or `$SLP` sleep. Halt recovery is `M999`.

import { buildAbsoluteFrameLines, buildRelativeJogCommand } from '../relative-jog-commands';

/** Home all configured axes (Smoothie's homing cycle). */
export const SMOOTHIE_CMD_HOME = 'G28.2';

/** Clear the halted (kill/limit) state. */
export const SMOOTHIE_CMD_UNLOCK = 'M999';

export const SMOOTHIE_CMD_POSITION = 'M114';
export const SMOOTHIE_CMD_FIRMWARE_INFO = 'M115';
export const SMOOTHIE_CMD_VERSION = 'version';

/** Beam-off cleanup after stop: M5 (laser off) then M9 (air assist off). */
export const SMOOTHIE_STOP_LASER_LINES: ReadonlyArray<string> = ['M5', 'M9'];

// Post-job settle marker. Smoothieware follows the RepRap convention where G4 P
// is MILLISECONDS (not GRBL's seconds), so `G4 P0.01` acks almost immediately and
// the settle could clear the streamer while buffered motion is still draining —
// the same failure CTL-02 fixed for Marlin. M400 ("wait for the move queue to
// empty") acks only once motion has finished. NOT hardware-verified.
export const SMOOTHIE_CMD_SETTLE = 'M400';

// Smoothieware has no native jog protocol: reuse the shared relative-jog /
// absolute-frame builders (byte-identical to the Marlin path).
export const buildSmoothieJogCommand = buildRelativeJogCommand;
export const buildSmoothieFrameLines = buildAbsoluteFrameLines;

// laser-stream-dwell — a programmed dwell is not a controller hold (controller
// audit ST-5). GRBL answers `G4 P<s>` only after the planner drains and the
// dwell ends, and reports Idle meanwhile (motion_control.c mc_dwell:
// protocol_buffer_synchronize(), then delay_sec). KerfDesk's CNC emitter
// writes `G4 P<spindleSpinupSec>` after every M3 (cnc-grbl-transitions.ts), so
// a spin-up of 3 s or more looked like the controller holding the program.
// P is seconds only in the GRBL family; Marlin and Smoothieware read it as
// milliseconds.
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L195-L200

import type { ControllerKind } from '../../core/devices';

const GRBL_FAMILY: ReadonlyArray<ControllerKind> = ['grbl-v1.1', 'grblhal', 'fluidnc'];
const DWELL_RE = /^(?:N\d+\s*)?G0*4(?![\d.])(?:[^P]*)P\s*(\d*\.?\d+)/;

/** Seconds of the `G4 P` dwell `line` programs on a GRBL-family controller,
 * or null for any other line or controller. */
export function programmedDwellSeconds(
  controllerKind: ControllerKind,
  line: string | undefined,
): number | null {
  if (line === undefined || !GRBL_FAMILY.includes(controllerKind)) return null;
  const code = line
    .replace(/\([^)]*\)/g, '')
    .replace(/;.*$/, '')
    .trim()
    .toUpperCase();
  const seconds = Number(DWELL_RE.exec(code)?.[1] ?? Number.NaN);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

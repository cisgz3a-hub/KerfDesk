// Smoothieware answers `$H` with `ok` whether or not anything homed: SimpleShell
// prints it unconditionally after dispatching G28 or G28.2 (SimpleShell.cpp:241-
// 252 at 38e2cc08). A board without homing pins has no Endstops module (it
// deletes itself, Endstops.cpp:114-129), and one whose pins are all limit-only
// prints "WARNING: Nothing to home" (Endstops.cpp:849-852). G28.6 prints
// `<axis>:<homed> ` for each axis that has a homing pin (Endstops.cpp:1114-
// 1120), and the flag stays set until a reset or a failed cycle clears it
// (:902, :957-958). KerfDesk confirms a Home only when G28.6 lists X:1 and Y:1
// (controller audit 2026-09-25 SM-6). Builds before G28.6 (fdfa00d2,
// 2016-10-01) print no flags, so their Home is not confirmed.

import type { HomeVerification } from '../controller-driver';

export const SMOOTHIE_HOMED_AXES_QUERY = 'G28.6';

/** The whole line G28.6 prints, e.g. `X:1 Y:1 Z:0`. The classifier files it as
 *  a message so the store does not treat it as a possible banner. */
export const SMOOTHIE_HOMED_FLAGS_LINE_RE = /^(?:[XYZABC]:[01]\s*)+$/;

const HOMED_FLAG_RE = /\b([XYZABC]):([01])\b/g;

export function smoothieUnhomedReason(responses: ReadonlyArray<string>): string | null {
  const flags = new Map<string, string>();
  for (const line of responses) {
    for (const match of line.matchAll(HOMED_FLAG_RE)) flags.set(match[1] ?? '', match[2] ?? '');
  }
  if (flags.size === 0) {
    return (
      'The controller reports no homing switches (G28.6), so its Home moved nothing: the ' +
      'Endstops module is not loaded. Configure homing on the board, or turn homing off in ' +
      'Machine Setup and set the origin by hand.'
    );
  }
  const unhomed = ['X', 'Y'].filter((axis) => flags.get(axis) !== '1');
  if (unhomed.length === 0) return null;
  return (
    `The controller reports ${unhomed.join(' and ')} not homed after Home (G28.6): ` +
    `${unhomed.length > 1 ? 'those axes have' : 'that axis has'} no homing switch, or the cycle ` +
    'did not finish. Check the Endstops configuration, then Home again.'
  );
}

export const smoothieHomeVerification: HomeVerification = {
  query: SMOOTHIE_HOMED_AXES_QUERY,
  unhomedReason: smoothieUnhomedReason,
};

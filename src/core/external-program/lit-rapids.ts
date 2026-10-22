// lit-rapids — the G0 moves an opened program makes with the laser on, which
// burn when the controller's laser mode is off (ADR-630 Amendment 4). GRBL
// turns the laser off on every motion other than G1, G2 and G3 only in laser
// mode: gnea/grbl gcode.c sets GC_PARSER_LASER_DISABLE inside
// `if (bit_istrue(settings.flags, BITFLAG_LASER_MODE))`, grblHAL under
// `settings.mode == Mode_Laser` and FluidNC under `spindle->isRateAdjusted()`.
// With `$32=0` a G0 runs at the S in force while M3 or M4 is on.
//
// KerfDesk's own output writes S0 on every G0 (PROJECT.md non-negotiable 3);
// an opened program may not. Within a block GRBL sets S and switches the
// spindle before it moves, and ends the program (M2/M30) after. The GRBL
// power oracle (grbl-laser-power-model.ts) checks this scan in its tests.

import { scanModalMotionLine, type GcodeMotionMode } from '../gcode/modal-motion-line';
import { scanGcodeWords } from '../gcode/word-scan';

export type LitRapids = {
  readonly count: number;
  /** One-based line of the first one in the sent program. */
  readonly firstLine: number;
};

/** The G0 moves made while M3 or M4 is on and S has not been set to 0, or
 * null when there are none. An S the program never set counts: GRBL keeps S
 * from whatever ran before, so it is not known to be 0. */
export function findLitRapids(gcode: string): LitRapids | null {
  const spindle: SpindleState = { on: false, speedZero: false };
  let motion: GcodeMotionMode | null = 0;
  let count = 0;
  let firstLine = 0;
  const lines = gcode.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const ends = applySpindleWords(spindle, line);
    const scanned = scanModalMotionLine(line, motion);
    motion = scanned.motion;
    if (scanned.isMotion && motion === 0 && spindle.on && !spindle.speedZero) {
      if (count === 0) firstLine = index + 1;
      count += 1;
    }
    // gcode.c resets the motion mode to G1 at a program end, too.
    if (ends) {
      spindle.on = false;
      motion = 1;
    }
  }
  return count === 0 ? null : { count, firstLine };
}

type SpindleState = { on: boolean; speedZero: boolean };

/** Applies a block's S and M3/M4/M5, which act before its move. True when the
 * block ends the program (M2/M30), which acts after it. */
function applySpindleWords(spindle: SpindleState, line: string): boolean {
  let ends = false;
  for (const word of scanGcodeWords(line)) {
    if (word.letter === 'S') spindle.speedZero = word.value === 0;
    if (word.letter !== 'M') continue;
    const code = Math.round(word.value * 10) / 10;
    if (code === 3 || code === 4) spindle.on = true;
    else if (code === 5) spindle.on = false;
    else if (code === 2 || code === 30) ends = true;
  }
  return ends;
}

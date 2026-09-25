// Marlin stream-side Pause and the beam (controller audit MA-1). Marlin has no
// realtime hold, so Pause only stops sending and the moves Marlin already
// accepted run to the end of its planner. What the beam does after that
// depends on the power commands the job was written in:
//  - Fan-wired laser (marlin-fan-transform.ts, M106/M107). M106 sets the fan
//    speed at once (M106_M107.cpp L85-L91); a planned move keeps the speed it
//    was planned with, and once the planner is empty Planner::
//    check_axes_activity() drives the fan from the current speed
//    (planner.cpp L1388-L1399). A paused burn therefore keeps burning the
//    stopped head, with no timeout. M107 queued behind the moves sets the
//    speed to 0: the buffered burns finish at their own power and the output
//    drops when the planner empties.
//  - LASER_FEATURE inline mode (marlin-inline-transform.ts, M3 I / M5 I). In
//    continuous mode nothing blanks the output when the planner runs dry
//    (stepper.cpp L2341-L2346 blanks dynamic mode only), so the last burn power
//    stays on until LASER_SAFETY_TIMEOUT_MS (1 s stock; temperature.cpp
//    L3516-L3521), or for good on a build without it. M5 I synchronizes, then
//    zeroes the output and leaves inline mode (M3-M5.cpp L142-L154).
// Resume brings the beam back in the program's own commands, as resume
// transform 3 does (ADR-364): the fan speed the program held goes back on with
// its own `M106 S` immediately before the next move, and an armed inline beam
// is re-armed with `M3 I S0` (plain M3 would not re-enable the output,
// M3-M5.cpp L84-L88) with the held power restated on the next burn move, since
// a G1 after `M3 I S0` runs at 0.
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/planner.cpp#L1388-L1399
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M3-M5.cpp#L75-L154

import type { StreamPauseBeamPlan } from '../controller-driver';
import {
  stripComments,
  withPowerText,
  wordsForLine,
  type GcodeWord,
} from '../grbl/laser-resume-reentry';
import {
  applyNativeBeamLine,
  createNativeLaserBeam,
  nativeBeamArmed,
  type PowerWord,
} from '../grbl/native-laser-resume-beam';

type HeldInlineBeam = {
  /** The inline mode the program selected; M5 I leaves it. */
  readonly mode: 'M3' | 'M4';
  /** The inline output is enabled (M3 I / M4 I), so moves burn. */
  readonly armed: boolean;
  /** The power a burn move without its own S word runs at. */
  readonly power: PowerWord | null;
};

// M106 without S runs the fan at full speed (M106_M107.cpp: dspeed = 255).
const FULL_FAN: PowerWord = { value: 255, text: '255' };
const MOVE_AXES: ReadonlySet<string> = new Set(['X', 'Y', 'Z', 'I', 'J']);

/** The beam handling of a Marlin stream-side Pause at `queueIndex`, the
 * first stream line not yet sent. */
export function planMarlinStreamPauseBeam(
  streamLines: ReadonlyArray<string>,
  queueIndex: number,
): StreamPauseBeamPlan {
  const sent = Math.max(0, Math.min(queueIndex, streamLines.length));
  const fan = heldFanPower(streamLines, sent);
  const inline = heldInlineBeam(streamLines, sent);
  const resumes = sent < streamLines.length;
  return {
    offLines: [...(fan === null ? [] : ['M107']), ...(inline === null ? [] : ['M5 I'])],
    restoreLines: resumes ? [...fanRestore(fan, streamLines, sent), ...inlineRearm(inline)] : [],
    restatedLine: resumes ? restatedBurnMove(inline, streamLines, sent) : null,
  };
}

/** The fan speed the sent lines left, when it is above zero. */
function heldFanPower(lines: ReadonlyArray<string>, sent: number): PowerWord | null {
  for (let index = sent - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    if (!/m/i.test(line)) continue;
    const words = wordsForLine(line);
    const command = marlinCommand(words);
    if (command?.letter !== 'M') continue;
    if (command.value === 107) return null;
    if (command.value !== 106) continue;
    const power = lastWord(words, 'S') ?? FULL_FAN;
    return power.value > 0 ? power : null;
  }
  return null;
}

/** The inline cutter the sent lines left, or null when inline mode is off.
 * Only the lines since the last inline mode switch (M3 I, M4 I, M5 I) matter,
 * so a long job is scanned from there. */
function heldInlineBeam(lines: ReadonlyArray<string>, sent: number): HeldInlineBeam | null {
  let start = sent - 1;
  while (start >= 0 && !isInlineModeSwitch(lines[start] ?? '')) start -= 1;
  if (start < 0) return null;
  const beam = createNativeLaserBeam('marlin-inline');
  for (let index = start; index < sent; index += 1) {
    const line = lines[index] ?? '';
    applyNativeBeamLine(beam, line, wordsForLine(line));
  }
  if (beam.inlineMode === null) return null;
  return { mode: beam.inlineMode, armed: nativeBeamArmed(beam), power: beam.power };
}

function isInlineModeSwitch(line: string): boolean {
  if (!/m/i.test(line)) return false;
  const command = marlinCommand(wordsForLine(line));
  if (command?.letter !== 'M' || ![3, 4, 5].includes(command.value)) return false;
  return /\bI(?=\s|$)/i.test(stripComments(line));
}

/** `M106 S<held>` when the next line is the move it must light, unless the
 * program sets the fan itself first. When other lines come before that move
 * the fan is not restored early: it would light the standing head while they
 * run, and the program's own next M106 brings the power back. */
function fanRestore(
  fan: PowerWord | null,
  lines: ReadonlyArray<string>,
  sent: number,
): ReadonlyArray<string> {
  if (fan === null) return [];
  const next = wordsForLine(lines[sent] ?? '');
  return movesHead(next) ? [`M106 S${fan.text}`] : [];
}

function inlineRearm(inline: HeldInlineBeam | null): ReadonlyArray<string> {
  return inline?.armed === true ? [`${inline.mode} I S0`] : [];
}

/** After `M3 I S0` the inline power is 0, so the first burn move that relies
 * on the held S gets it restated. Scanning stops at the first line that sets
 * the power itself: G0 (zeroes it), M3/M4/M5, or a move with its own S. */
function restatedBurnMove(
  inline: HeldInlineBeam | null,
  lines: ReadonlyArray<string>,
  sent: number,
): StreamPauseBeamPlan['restatedLine'] {
  const power = inline?.armed === true ? inline.power : null;
  if (power === null || power.value <= 0) return null;
  for (let index = sent; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const step = burnScanStep(wordsForLine(line));
    if (step === 'stop') return null;
    if (step === 'restate') {
      const restated = withPowerText(line.replace(/\n$/, ''), power.text);
      return { offset: index - sent, line: `${restated}\n` };
    }
  }
  return null;
}

/** What one line after the pause point means for the held inline power. */
function burnScanStep(words: ReadonlyArray<GcodeWord>): 'skip' | 'stop' | 'restate' {
  const command = marlinCommand(words);
  if (command === null) return 'skip';
  if (command.letter === 'M') return [3, 4, 5].includes(command.value) ? 'stop' : 'skip';
  if (command.value > 3) return 'skip';
  if (command.value === 0 || lastWord(words, 'S') !== null) return 'stop';
  return movesHead(words) ? 'restate' : 'skip';
}

// Marlin moves only on a G0-G3 command with a destination.
function movesHead(words: ReadonlyArray<GcodeWord>): boolean {
  const command = marlinCommand(words);
  return (
    command?.letter === 'G' &&
    command.value >= 0 &&
    command.value <= 3 &&
    words.some(({ letter }) => MOVE_AXES.has(letter))
  );
}

// Marlin runs one command per line: the first G or M word; the rest are its
// parameters.
function marlinCommand(words: ReadonlyArray<GcodeWord>): GcodeWord | null {
  return words.find(({ letter }) => letter === 'G' || letter === 'M') ?? null;
}

function lastWord(words: ReadonlyArray<GcodeWord>, letter: string): PowerWord | null {
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (word?.letter === letter) return word;
  }
  return null;
}

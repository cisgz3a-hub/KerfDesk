// The beam a Smoothieware or Marlin laser program holds at a resume line, read
// in the power commands its output strategy writes (resume transform 3,
// ADR-364). Each rule follows the firmware source:
//  - Smoothieware (smoothieware-strategy.ts; Laser.cpp, Robot.cpp and
//    GcodeDispatch.cpp on the edge branch). `fire off` ends manual fire, in
//    which the beam ignores motion. `M221 S<percent>` scales the power of every
//    later G1/G2/G3 block at once, and `P1`/`P0` turns proportional power
//    off/on. S is modal on G0-G3 lines, and a G0 block never fires. The
//    strategy writes `M400` + `M221 S100 P1|P0` for GRBL's M3/M4 and `M400` +
//    `M221 S0` for M5, so an `M221 S` is a percent, never a power.
//  - Marlin inline (marlin-inline-transform.ts; Marlin 2.1.2.6 M3-M5.cpp and
//    GcodeSuite::get_destination_from_command). `M3 I` selects continuous
//    inline power and enables it. The S word of a G1/G2/G3 sets the power of
//    the moves that follow, a G0 sets it to 0, and M5 disables it; `M5 I` also
//    leaves inline mode. Outside inline mode a G1 S word sets nothing.
//  - Marlin fan (marlin-fan-transform.ts; M106_M107.cpp, planner.cpp).
//    `M106 S<0-255>` drives the beam through the fan output on every move, G0
//    included, and `M107` turns it off.

import { stripComments, type GcodeWord, type LaserResumeWcs } from './laser-resume-reentry';
import type { LaserResumeDialect } from './laser-resume-dialect';

export type NativeLaserDialect = Exclude<LaserResumeDialect, 'grbl'>;

/** A power or percent word, spelled as the program spells it. */
export type PowerWord = { readonly value: number; readonly text: string };

export type NativeLaserBeam = {
  readonly dialect: NativeLaserDialect;
  /** Smoothieware: a `fire off` put the laser module in automatic mode. */
  autoMode: boolean;
  /** Smoothieware `M221 S` percent; null until the program sets one. */
  scale: PowerWord | null;
  /** Smoothieware `M221 P`: 1 constant power, 0 proportional power. */
  proportional: string | null;
  /** Marlin inline mode (`M3 I` continuous, `M4 I` dynamic); null is standard. */
  inlineMode: 'M3' | 'M4' | null;
  /** Marlin inline output enabled: `M3 I` sets it, M5 clears it. */
  enabled: boolean;
  /** The power the next burn move without its own S word runs at; for the fan
   * dialect, the fan output. */
  power: PowerWord | null;
  /** Marlin `cutter.unitPower`: what an `M3`/`M4` without S selects again. */
  unitPower: PowerWord | null;
  /** The G54-G59 system the program selected, if any. */
  wcs: LaserResumeWcs | null;
};

/** What one program line does to the power the replay follows. */
export type BeamLineEffect = {
  /** The line's own power word, when it sets the power of later moves. */
  readonly power: PowerWord | null;
  /** The line arms the beam, so it is replayed with power zero, as GRBL's M3/M4. */
  readonly arms: boolean;
  /** After this line the controller holds zero power (Marlin G0 and M5). */
  readonly zeroes: boolean;
};

const NO_EFFECT: BeamLineEffect = { power: null, arms: false, zeroes: false };
const ZERO_POWER: PowerWord = { value: 0, text: '0' };
// M106 without S runs the fan at full speed (M106_M107.cpp: dspeed = 255).
const FULL_FAN: PowerWord = { value: 255, text: '255' };

export function createNativeLaserBeam(dialect: NativeLaserDialect): NativeLaserBeam {
  return {
    dialect,
    autoMode: false,
    scale: null,
    proportional: null,
    inlineMode: null,
    enabled: false,
    power: null,
    unitPower: null,
    wcs: null,
  };
}

/** Applies one program line to the beam and reports what it did to the power. */
export function applyNativeBeamLine(
  beam: NativeLaserBeam,
  rawLine: string,
  words: ReadonlyArray<GcodeWord>,
): BeamLineEffect {
  noteWorkSystem(beam, words);
  if (beam.dialect === 'smoothieware') return applySmoothieLine(beam, rawLine, words);
  if (beam.dialect === 'marlin-inline') return applyMarlinInlineLine(beam, rawLine, words);
  applyMarlinFanLine(beam, words);
  return NO_EFFECT;
}

/** The program's beam fires on burn moves, given the power it holds. */
export function nativeBeamArmed(beam: NativeLaserBeam): boolean {
  if (beam.dialect === 'smoothieware') return beam.scale === null || beam.scale.value > 0;
  return beam.dialect === 'marlin-inline' && beam.inlineMode !== null && beam.enabled;
}

function noteWorkSystem(beam: NativeLaserBeam, words: ReadonlyArray<GcodeWord>): void {
  for (const { letter, value } of words) {
    if (letter === 'G' && Number.isInteger(value) && value >= 54 && value <= 59) {
      beam.wcs = `G${value}` as LaserResumeWcs;
    }
  }
}

function applySmoothieLine(
  beam: NativeLaserBeam,
  rawLine: string,
  words: ReadonlyArray<GcodeWord>,
): BeamLineEffect {
  // Laser.cpp accepts `fire off` and `fire 0` as the way back to automatic mode.
  const command = stripComments(rawLine).trim();
  if (command === 'fire off' || command === 'fire 0') {
    beam.autoMode = true;
    return NO_EFFECT;
  }
  if (hasWord(words, 'M', 221)) {
    beam.scale = lastWord(words, 'S') ?? beam.scale;
    beam.proportional = lastWord(words, 'P')?.text ?? beam.proportional;
    return NO_EFFECT;
  }
  const power = lastWord(words, 'S');
  if (power === null || !isSmoothieMotionLine(words)) return NO_EFFECT;
  beam.power = power;
  return { power, arms: false, zeroes: false };
}

// Robot.cpp keeps an S word only on G0-G3 lines; GcodeDispatch runs a line of
// bare axis words in the last G0-G3 mode. Every other command's S is its own.
function isSmoothieMotionLine(words: ReadonlyArray<GcodeWord>): boolean {
  const motionWord = words.some(({ letter, value }) => letter === 'G' && value >= 0 && value <= 3);
  return motionWord || !words.some(({ letter }) => letter === 'G' || letter === 'M');
}

function applyMarlinInlineLine(
  beam: NativeLaserBeam,
  rawLine: string,
  words: ReadonlyArray<GcodeWord>,
): BeamLineEffect {
  const command = marlinCommand(words);
  if (command?.letter === 'M') return applyMarlinCutterCommand(beam, rawLine, command.value, words);
  if (command === null || beam.inlineMode === null) return NO_EFFECT;
  if (command.value === 0) {
    beam.power = ZERO_POWER;
    return { power: null, arms: false, zeroes: true };
  }
  if (command.value < 1 || command.value > 3) return NO_EFFECT;
  // gcode.cpp: an I word on G1-G3 re-enables the output (LightBurn compatibility).
  if (hasWord(words, 'I') || hasInlineFlag(rawLine)) beam.enabled = true;
  const power = lastWord(words, 'S');
  if (power === null) return NO_EFFECT;
  beam.power = power;
  beam.unitPower = power;
  return { power, arms: false, zeroes: false };
}

function applyMarlinCutterCommand(
  beam: NativeLaserBeam,
  rawLine: string,
  code: number,
  words: ReadonlyArray<GcodeWord>,
): BeamLineEffect {
  if (code === 3 || code === 4) {
    return armMarlin(beam, code, hasInlineFlag(rawLine), lastWord(words, 'S'));
  }
  if (code !== 5) return NO_EFFECT;
  // M5 disables the output; `M5 I` also returns to standard mode.
  beam.enabled = false;
  if (hasInlineFlag(rawLine)) beam.inlineMode = null;
  beam.power = ZERO_POWER;
  return { power: null, arms: false, zeroes: true };
}

function armMarlin(
  beam: NativeLaserBeam,
  command: 3 | 4,
  inline: boolean,
  power: PowerWord | null,
): BeamLineEffect {
  if (inline) {
    beam.inlineMode = command === 3 ? 'M3' : 'M4';
    beam.enabled = true;
  }
  beam.unitPower = power ?? beam.unitPower;
  // In inline mode M3/M4 set the power of the following moves: their S, or
  // the last unit power without one.
  if (beam.inlineMode !== null) beam.power = beam.unitPower ?? ZERO_POWER;
  return { power, arms: true, zeroes: false };
}

function applyMarlinFanLine(beam: NativeLaserBeam, words: ReadonlyArray<GcodeWord>): void {
  const command = marlinCommand(words);
  if (command?.letter !== 'M') return;
  if (command.value === 107) beam.power = ZERO_POWER;
  if (command.value === 106) beam.power = lastWord(words, 'S') ?? FULL_FAN;
}

// Marlin runs one command per line: the first G or M word; the rest are its
// parameters.
function marlinCommand(words: ReadonlyArray<GcodeWord>): GcodeWord | null {
  return words.find(({ letter }) => letter === 'G' || letter === 'M') ?? null;
}

// The bare `I` of `M3 I` has no number, so it is not an address word.
function hasInlineFlag(rawLine: string): boolean {
  return /\bI(?=\s|$)/i.test(stripComments(rawLine));
}

function hasWord(words: ReadonlyArray<GcodeWord>, letter: string, value?: number): boolean {
  return words.some(
    (word) => word.letter === letter && (value === undefined || word.value === value),
  );
}

function lastWord(words: ReadonlyArray<GcodeWord>, letter: string): PowerWord | null {
  for (let i = words.length - 1; i >= 0; i -= 1) {
    const word = words[i];
    if (word?.letter === letter) return word;
  }
  return null;
}

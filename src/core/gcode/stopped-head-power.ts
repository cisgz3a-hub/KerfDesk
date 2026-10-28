// Whether a program burns with a power that stays on when the controller runs
// out of buffered moves and stops the head (rolling audit v6 K1, ADR-676). A
// stream that stops being refilled, such as one sent from a busy app window,
// leaves the head stopped with the power its last move set. Firmware behaviour
// at that stop, from the pinned sources the audit cites:
//   - GRBL, grblHAL, FluidNC: an M4 (laser-mode dynamic) block turns the PWM
//     off when the segment buffer runs dry; an M3 block keeps S on, with no
//     timeout (gnea/grbl stepper.c L392-L397, L741-L746; grblHAL stepper.c
//     L578-L586, gcode.c L4424; FluidNC v4.0.3 Stepper.cpp L233-L241);
//   - Marlin's cutter (M3/M4 in standard mode, `M3 I` continuous inline) keeps
//     its power until LASER_SAFETY_TIMEOUT_MS, 1 s in stock builds and none
//     when a build sets 0 (stepper.cpp L2341-L2346, temperature.cpp
//     L3516-L3521); only `M4 I` (dynamic inline) blanks at once;
//   - Marlin's fan output (M106 S) keeps its speed, with no timeout
//     (planner.cpp L1388-L1399).
// The scan reads the exact program and reports the first lit move of that
// kind, or null. Smoothieware goes dark at every stop and is not scanned.

import { scanGcodeWords, stripControllerComments } from './word-scan';

export type StoppedHeadPower = 'grbl-constant' | 'marlin-cutter' | 'marlin-fan';

export type StoppedHeadPowerFinding = {
  readonly kind: StoppedHeadPower;
  /** 1-based line of the first lit move that would stay lit at a stop. */
  readonly line: number;
};

export function findStoppedHeadPower(
  gcode: string,
  firmware: 'grbl' | 'marlin',
): StoppedHeadPowerFinding | null {
  // Cheap rejects first: a GRBL program with no M3, or a Marlin one with
  // neither a cutter nor a fan command, can light nothing that stays lit.
  if (firmware === 'grbl' ? !/M0*3(?!\d)/i.test(gcode) : !/M0*(?:3|4|106)(?!\d)/i.test(gcode)) {
    return null;
  }
  const state = firmware === 'grbl' ? grblScan() : marlinScan();
  let start = 0;
  for (let lineNumber = 1; start <= gcode.length; lineNumber += 1) {
    const end = gcode.indexOf('\n', start);
    const raw = gcode.slice(start, end < 0 ? gcode.length : end);
    const kind = state(stripControllerComments(raw));
    if (kind !== null) return { kind, line: lineNumber };
    if (end < 0) break;
    start = end + 1;
  }
  return null;
}

type LineScan = (line: string) => StoppedHeadPower | null;

type Words = ReturnType<typeof scanGcodeWords>;

function wordValues(words: Words, letter: string): ReadonlyArray<number> {
  return words.filter((word) => word.letter === letter).map((word) => word.value);
}

function hasAxisWord(words: Words): boolean {
  return words.some((word) => word.letter === 'X' || word.letter === 'Y' || word.letter === 'Z');
}

/** The motion mode a line sets, or the previous one. */
function motionMode(words: Words, previous: number): number {
  const motion = wordValues(words, 'G').filter((g) => g === 0 || g === 1 || g === 2 || g === 3);
  return motion.at(-1) ?? previous;
}

// GRBL modal state: the spindle direction (M3/M4/M5, M2/M30 end the program
// with the spindle off), the S word and the motion mode.
type GrblSpindle = 'cw' | 'ccw' | 'off';

function grblScan(): LineScan {
  let spindle: GrblSpindle = 'off';
  let power = 0;
  let motion = 0;
  return (line) => {
    const words = scanGcodeWords(line);
    if (words.length === 0) return null;
    spindle = wordValues(words, 'M').reduce(grblSpindleAfter, spindle);
    power = wordValues(words, 'S').at(-1) ?? power;
    motion = motionMode(words, motion);
    const lit = spindle === 'cw' && power > 0 && motion !== 0 && hasAxisWord(words);
    return lit ? 'grbl-constant' : null;
  };
}

function grblSpindleAfter(spindle: GrblSpindle, m: number): GrblSpindle {
  if (m === 3) return 'cw';
  if (m === 4) return 'ccw';
  return m === 5 || m === 2 || m === 30 ? 'off' : spindle;
}

// Marlin (marlin-laser-power-model.ts): `M3 I`/`M4 I` select continuous or
// dynamic inline mode and `M5 I` returns to standard; in inline mode a G1-G3 S
// sets the move's power and a G0 plans none. In standard mode M3/M4 S drive
// the cutter directly. M106 S (255 without S) and M107 set the fan.
type MarlinPowerState = {
  inline: 'standard' | 'continuous' | 'dynamic';
  cutter: number;
  inlinePower: number;
  fan: number;
  motion: number;
};

function marlinScan(): LineScan {
  const state: MarlinPowerState = {
    inline: 'standard',
    cutter: 0,
    inlinePower: 0,
    fan: 0,
    motion: 0,
  };
  return (line) => {
    const words = scanGcodeWords(line);
    if (words.length === 0) return null;
    const s = wordValues(words, 'S').at(-1);
    const inlineFlag = /\bI(?![\d.+-])/i.test(line);
    for (const m of wordValues(words, 'M')) applyMarlinMCode(state, m, s, inlineFlag);
    state.motion = motionMode(words, state.motion);
    return hasAxisWord(words) ? marlinMoveLit(state, s) : null;
  };
}

function applyMarlinMCode(
  state: MarlinPowerState,
  m: number,
  s: number | undefined,
  inlineFlag: boolean,
): void {
  if (m === 3 || m === 4) applyMarlinCutterOn(state, m, s, inlineFlag);
  else if (m === 5) {
    state.cutter = 0;
    state.inlinePower = 0;
    if (inlineFlag) state.inline = 'standard';
  } else if (m === 106) state.fan = s ?? 255;
  else if (m === 107) state.fan = 0;
}

function applyMarlinCutterOn(
  state: MarlinPowerState,
  m: 3 | 4,
  s: number | undefined,
  inlineFlag: boolean,
): void {
  if (inlineFlag) state.inline = m === 3 ? 'continuous' : 'dynamic';
  if (state.inline === 'standard') state.cutter = s ?? state.cutter;
  else if (s !== undefined) state.inlinePower = s;
}

function marlinMoveLit(state: MarlinPowerState, s: number | undefined): StoppedHeadPower | null {
  // The fan output is on for any move, travel included, until M107.
  if (state.fan > 0) return 'marlin-fan';
  if (state.inline !== 'standard') {
    state.inlinePower = state.motion === 0 ? 0 : (s ?? state.inlinePower);
    return state.inline === 'continuous' && state.motion !== 0 && state.inlinePower > 0
      ? 'marlin-cutter'
      : null;
  }
  return state.motion !== 0 && state.cutter > 0 ? 'marlin-cutter' : null;
}

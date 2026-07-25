// Word-effect layer of the render model (ADR-255 stage 2): applies modal
// F/S, shared motion words, recognized no-ops (G17/G54-G59/G94 — the words
// our own emitters write), events, and unsupported-word accounting. Geometry
// emission lives in gcode-render-model.ts.

import { applySharedGCode } from '../gcode';
import type { GcodeWordMatch } from '../gcode';
import type { ProgramEvent } from './render-model-types';

export type RenderModal = {
  motion: 0 | 1 | 2 | 3;
  unitScale: number;
  absolute: boolean;
  x: number;
  y: number;
  z: number;
  feed: number;
  power: number;
  plane: 17 | 18 | 19;
  ended: boolean;
};

export type LineWordOutcome = {
  readonly sawModal: boolean;
  readonly sawEvent: boolean;
  readonly sawUnsupported: boolean;
  /** Axis/arc words left for the motion layer (X/Y/Z/I/J/R). */
  readonly axisWords: ReadonlyMap<string, number>;
  /** G28 home request: axes named on the line (empty = all). Null otherwise. */
  readonly homeAxes: ReadonlyArray<'X' | 'Y' | 'Z'> | null;
};

export type WordAccounting = {
  readonly countUnsupported: (word: string, line: number) => void;
  readonly pushEvent: (event: ProgramEvent) => void;
};

const AXIS_LETTERS = new Set(['X', 'Y', 'Z', 'I', 'J', 'R']);
const WCS_FIRST = 54;
const WCS_LAST = 59;

type LineTally = {
  readonly axisWords: Map<string, number>;
  sawModal: boolean;
  sawEvent: boolean;
  sawUnsupported: boolean;
  dwellSeconds: number | null;
  sawDwell: boolean;
  sawHome: boolean;
};

/**
 * Applies every non-axis word of one line to the modal state, records events
 * and unsupported words, and returns the axis words plus category evidence.
 * Order: F/S first (so a same-line M3 reports the new power, matching GRBL),
 * then G words in source order, then M words.
 */
export function applyLineWords(
  modal: RenderModal,
  words: ReadonlyArray<GcodeWordMatch>,
  line: number,
  accounting: WordAccounting,
): LineWordOutcome {
  const tally: LineTally = {
    axisWords: new Map(),
    sawModal: false,
    sawEvent: false,
    sawUnsupported: false,
    dwellSeconds: null,
    sawDwell: false,
    sawHome: false,
  };
  for (const word of words) applyOneWord(modal, word, line, accounting, tally);
  resolveDwell(tally, line, accounting);
  const homeAxes = resolveHome(tally, line, accounting);
  return {
    sawModal: tally.sawModal,
    sawEvent: tally.sawEvent,
    sawUnsupported: tally.sawUnsupported,
    axisWords: tally.sawHome ? new Map() : tally.axisWords,
    homeAxes,
  };
}

function applyOneWord(
  modal: RenderModal,
  word: GcodeWordMatch,
  line: number,
  accounting: WordAccounting,
  tally: LineTally,
): void {
  if (AXIS_LETTERS.has(word.letter)) {
    tally.axisWords.set(word.letter, word.value);
    return;
  }
  if (word.letter === 'F') {
    // F is interpreted in the units in force when the word executes
    // (RS274 order: feed before a same-line units change). Stored in mm/min.
    modal.feed = word.value * modal.unitScale;
    tally.sawModal = true;
    return;
  }
  if (word.letter === 'S' || word.letter === 'N') {
    if (word.letter === 'S') modal.power = word.value;
    tally.sawModal = true;
    return;
  }
  if (word.letter === 'P') {
    tally.dwellSeconds = word.value;
    return;
  }
  if (word.letter === 'T') {
    accounting.pushEvent({ kind: 'tool-word', line, tool: word.value });
    tally.sawEvent = true;
    return;
  }
  if (word.letter === 'G' || word.letter === 'M') {
    const outcome =
      word.letter === 'G'
        ? applyGWord(modal, word.value, line, accounting)
        : applyMWord(modal, word.value, line, accounting);
    noteOutcome(tally, outcome);
    return;
  }
  accounting.countUnsupported(word.letter, line);
  tally.sawUnsupported = true;
}

function noteOutcome(tally: LineTally, outcome: WordOutcome): void {
  if (outcome === 'dwell') tally.sawDwell = true;
  if (outcome === 'home') tally.sawHome = true;
  if (outcome === 'modal') tally.sawModal = true;
  if (outcome === 'unsupported') tally.sawUnsupported = true;
  if (outcome === 'event' || outcome === 'dwell' || outcome === 'home') tally.sawEvent = true;
}

function resolveDwell(tally: LineTally, line: number, accounting: WordAccounting): void {
  if (!tally.sawDwell) return;
  if (tally.dwellSeconds === null) {
    // G4 without P cannot dwell — GRBL rejects it; surface as unsupported.
    accounting.countUnsupported('G4', line);
    tally.sawUnsupported = true;
    return;
  }
  accounting.pushEvent({ kind: 'dwell', line, seconds: Math.max(0, tally.dwellSeconds) });
}

function resolveHome(
  tally: LineTally,
  line: number,
  accounting: WordAccounting,
): ReadonlyArray<'X' | 'Y' | 'Z'> | null {
  if (!tally.sawHome) return null;
  // Marlin-style G28: axis words are flags naming which axes home.
  const axes = (['X', 'Y', 'Z'] as const).filter((axis) => tally.axisWords.has(axis));
  accounting.pushEvent({ kind: 'home', line, axes });
  return axes;
}

type WordOutcome = 'modal' | 'event' | 'dwell' | 'home' | 'unsupported';

function applyGWord(
  modal: RenderModal,
  code: number,
  line: number,
  accounting: WordAccounting,
): WordOutcome {
  if (applySharedGCode(modal, code)) {
    pushUnitsEvent(code, line, accounting);
    return 'modal';
  }
  return applyExtendedGWord(modal, code, line, accounting);
}

function pushUnitsEvent(code: number, line: number, accounting: WordAccounting): void {
  if (code === 20) accounting.pushEvent({ kind: 'units', line, units: 'inch' });
  if (code === 21) accounting.pushEvent({ kind: 'units', line, units: 'mm' });
}

function applyExtendedGWord(
  modal: RenderModal,
  code: number,
  line: number,
  accounting: WordAccounting,
): WordOutcome {
  if (code === 17 || code === 18 || code === 19) {
    // Plane select is tracked so G18/G19 arcs are skipped (not fatal) — the
    // Inspector renders what it can (ADR-255 §5).
    modal.plane = code;
    return 'modal';
  }
  if (code === 4) return 'dwell';
  if (code === 28) return 'home';
  if (code === 94) return 'modal';
  if (Number.isInteger(code) && code >= WCS_FIRST && code <= WCS_LAST) {
    accounting.pushEvent({ kind: 'wcs-select', line, code });
    return 'event';
  }
  accounting.countUnsupported(`G${code}`, line);
  return 'unsupported';
}

function applyMWord(
  modal: RenderModal,
  code: number,
  line: number,
  accounting: WordAccounting,
): WordOutcome {
  if (code === 2 || code === 30) {
    modal.ended = true;
    accounting.pushEvent({ kind: 'program-end', line });
    return 'event';
  }
  if (code === 400) {
    // Marlin M400 (wait for moves to settle) — recognized no-op.
    return 'modal';
  }
  const event = mEventFor(code, line, modal.power);
  if (event === null) {
    accounting.countUnsupported(`M${code}`, line);
    return 'unsupported';
  }
  accounting.pushEvent(event);
  return 'event';
}

function mEventFor(code: number, line: number, power: number): ProgramEvent | null {
  if (code === 0 || code === 1) return { kind: 'pause', line, optional: code === 1 };
  return spindleOrCoolantEventFor(code, line, power);
}

function spindleOrCoolantEventFor(code: number, line: number, power: number): ProgramEvent | null {
  if (code === 3 || code === 4 || code === 106) {
    // M106 is the Marlin fan-dialect laser-on (mirrors the motion manifest).
    return { kind: 'spindle-on', line, mode: code === 3 ? 'constant' : 'dynamic', power };
  }
  if (code === 5 || code === 107) return { kind: 'spindle-off', line };
  if (code === 7 || code === 8) {
    return { kind: 'coolant-on', line, channel: code === 7 ? 'mist' : 'flood' };
  }
  if (code === 9) return { kind: 'coolant-off', line };
  return null;
}

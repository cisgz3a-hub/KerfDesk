// Word-effect layer of the render model (ADR-255 stage 2): applies modal
// F/S, shared motion words, recognized no-ops (G17/G54-G59/G94 — the words
// our own emitters write), events, and unsupported-word accounting. Geometry
// emission lives in gcode-render-model.ts.

import { applySharedGCode } from '../gcode';
import type { GcodeWordMatch } from '../gcode';
import { CANNED_CYCLES, type CannedCycle, type RetractMode } from './canned-cycle';
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
  spindleMode: 'off' | 'constant' | 'dynamic';
  coolantMist: boolean;
  coolantFlood: boolean;
  plane: 17 | 18 | 19;
  ended: boolean;
  /** Active canned drilling cycle (G73/G81/G82/G83); null after G80. */
  cycle: CannedCycle | null;
  /** G98 (retract to initial Z) or G99 (retract to R plane). */
  retractMode: RetractMode;
  /** Sticky cycle parameters — a bare X/Y line repeats the hole. */
  cycleR: number | null;
  cycleZ: number | null;
  cycleQ: number | null;
  /** Z the tool sat at when the cycle began: the G98 retract height. */
  cycleInitialZ: number;
};

export type LineWordOutcome = {
  readonly sawModal: boolean;
  readonly sawEvent: boolean;
  readonly sawUnsupported: boolean;
  /** Axis/arc words left for the motion layer (X/Y/Z/I/J/R). */
  readonly axisWords: ReadonlyMap<string, number>;
  /** G28 home request: axes named on the line (empty = all). Null otherwise. */
  readonly homeAxes: ReadonlyArray<'X' | 'Y' | 'Z'> | null;
  /** Q — canned-cycle peck depth, in the line's units. */
  readonly peckDepth: number | null;
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
  peckDepth: number | null;
  sawDwell: boolean;
  sawHome: boolean;
};

type WordEffectContext = {
  readonly modal: RenderModal;
  readonly linePower: number;
  readonly line: number;
  readonly accounting: WordAccounting;
};

type WordApplicationContext = WordEffectContext & {
  readonly tally: LineTally;
};

type LineMotionPresence = 'with-motion-words' | 'without-motion-words';

type ControllerSynchronizationContext = {
  readonly before: ControllerState;
  readonly after: RenderModal;
  readonly lineMotion: LineMotionPresence;
  readonly line: number;
  readonly accounting: WordAccounting;
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
  const before = controllerState(modal);
  const linePower = lastWordValue(words, 'S') ?? modal.power;
  const tally: LineTally = {
    axisWords: new Map(),
    sawModal: false,
    sawEvent: false,
    sawUnsupported: false,
    dwellSeconds: null,
    peckDepth: null,
    sawDwell: false,
    sawHome: false,
  };
  const context: WordApplicationContext = { modal, linePower, line, accounting, tally };
  for (const word of words) applyOneWord(word, context);
  resolveDwell(tally, line, accounting);
  const homeAxes = resolveHome(tally, line, accounting);
  const lineMotion: LineMotionPresence =
    tally.axisWords.size > 0 ? 'with-motion-words' : 'without-motion-words';
  if (pushControllerSynchronization({ before, after: modal, lineMotion, line, accounting })) {
    tally.sawEvent = true;
  }
  return {
    sawModal: tally.sawModal,
    sawEvent: tally.sawEvent,
    sawUnsupported: tally.sawUnsupported,
    axisWords: tally.sawHome ? new Map() : tally.axisWords,
    homeAxes,
    peckDepth: tally.peckDepth,
  };
}

function applyOneWord(word: GcodeWordMatch, context: WordApplicationContext): void {
  const { modal, line, accounting, tally } = context;
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
  if (word.letter === 'Q') {
    // Peck depth for a drilling cycle. Not an axis: on its own it commands
    // no motion, so it must not make a line look like a move.
    tally.peckDepth = word.value;
    tally.sawModal = true;
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
        : applyMWord(word.value, context);
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
  const cycleOutcome = applyCycleGWord(modal, code, line, accounting);
  if (cycleOutcome !== null) return cycleOutcome;
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

// G73/G81/G82/G83 start a cycle, G80 cancels it, G98/G99 set where it
// retracts to. Null when the code is none of those.
function applyCycleGWord(
  modal: RenderModal,
  code: number,
  line: number,
  accounting: WordAccounting,
): WordOutcome | null {
  if (isCannedCycle(code)) {
    // Capture the retract height BEFORE any of the cycle's own moves run —
    // G98 returns here, and the cycle word precedes the first hole.
    if (modal.cycle === null) modal.cycleInitialZ = modal.z;
    modal.cycle = code as CannedCycle;
    accounting.pushEvent({ kind: 'canned-cycle', line, code });
    return 'event';
  }
  if (code === 80) {
    modal.cycle = null;
    return 'modal';
  }
  if (code === 98 || code === 99) {
    modal.retractMode = code;
    return 'modal';
  }
  return null;
}

function isCannedCycle(code: number): boolean {
  return (CANNED_CYCLES as ReadonlyArray<number>).includes(code);
}

function applyMWord(code: number, context: WordEffectContext): WordOutcome {
  const { modal, linePower, line, accounting } = context;
  if (code === 2 || code === 30) {
    modal.ended = true;
    accounting.pushEvent({ kind: 'program-end', line });
    return 'event';
  }
  if (code === 400) {
    // Marlin/Smoothieware M400 has no duration of its own, but it drains the
    // planner. Preserve it as a timing synchronization boundary.
    accounting.pushEvent({
      kind: 'synchronization',
      line,
      code: 'M400',
      isBeforeMotion: false,
    });
    return 'event';
  }
  const event = mEventFor(code, line, linePower);
  if (event === null) {
    accounting.countUnsupported(`M${code}`, line);
    return 'unsupported';
  }
  applyControllerStateMCode(modal, code);
  accounting.pushEvent(event);
  return 'event';
}

function mEventFor(code: number, line: number, power: number): ProgramEvent | null {
  if (code === 0 || code === 1) return { kind: 'pause', line, optional: code === 1 };
  return spindleOrCoolantEventFor(code, line, power);
}

function spindleOrCoolantEventFor(code: number, line: number, power: number): ProgramEvent | null {
  // Marlin fan power is attached to planner blocks. M106/M107 stay domain
  // events only; controller-state tracking intentionally ignores them so they
  // cannot create full-stop synchronization boundaries.
  if (code === 3 || code === 4 || code === 106) {
    return { kind: 'spindle-on', line, mode: code === 3 ? 'constant' : 'dynamic', power };
  }
  if (code === 5 || code === 107) return { kind: 'spindle-off', line };
  if (code === 7 || code === 8) {
    return { kind: 'coolant-on', line, channel: code === 7 ? 'mist' : 'flood' };
  }
  if (code === 9) return { kind: 'coolant-off', line };
  return null;
}

type ControllerState = Pick<RenderModal, 'spindleMode' | 'power' | 'coolantMist' | 'coolantFlood'>;

function controllerState(modal: RenderModal): ControllerState {
  return {
    spindleMode: modal.spindleMode,
    power: modal.power,
    coolantMist: modal.coolantMist,
    coolantFlood: modal.coolantFlood,
  };
}

function lastWordValue(words: ReadonlyArray<GcodeWordMatch>, letter: string): number | null {
  let value: number | null = null;
  for (const word of words) {
    if (word.letter === letter) value = word.value;
  }
  return value;
}

function applyControllerStateMCode(modal: RenderModal, code: number): void {
  if (code === 3) modal.spindleMode = 'constant';
  if (code === 4) modal.spindleMode = 'dynamic';
  if (code === 5) modal.spindleMode = 'off';
  if (code === 7) modal.coolantMist = true;
  if (code === 8) modal.coolantFlood = true;
  if (code === 9) {
    modal.coolantMist = false;
    modal.coolantFlood = false;
  }
}

function pushControllerSynchronization(context: ControllerSynchronizationContext): boolean {
  const { before, after, lineMotion, line, accounting } = context;
  const hasSpindleModeChanged = before.spindleMode !== after.spindleMode;
  // Stock GRBL can carry laser S changes in the same planned motion block.
  // Standalone active-spindle speed changes drain the planner; app-emitted CNC
  // RPM changes use that form, while app-emitted laser power rides on motion.
  const hasStandaloneSpindleSpeedChanged =
    lineMotion === 'without-motion-words' &&
    after.spindleMode !== 'off' &&
    before.power !== after.power;
  const hasSpindleChanged = hasSpindleModeChanged || hasStandaloneSpindleSpeedChanged;
  const hasCoolantChanged =
    before.coolantMist !== after.coolantMist || before.coolantFlood !== after.coolantFlood;
  if (hasSpindleChanged) {
    accounting.pushEvent({
      kind: 'synchronization',
      line,
      code: 'spindle',
      isBeforeMotion: true,
    });
  }
  if (hasCoolantChanged) {
    accounting.pushEvent({
      kind: 'synchronization',
      line,
      code: 'coolant',
      isBeforeMotion: true,
    });
  }
  return hasSpindleChanged || hasCoolantChanged;
}
